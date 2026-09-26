import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from asking_monitor import store
from asking_monitor.classifier import classify
from asking_monitor.cli import DEFAULT_CONFIG, process
from asking_monitor.digest import write_digest
from asking_monitor.drafter import DRAFT_SCHEMA, draft, draft_with_claude
from asking_monitor.sources import Post, load_manual_file, parse_feed, parse_reddit_listing

SAMPLE = Path(__file__).parent.parent / "sample_data" / "sample_posts.json"


class ClassifierTest(unittest.TestCase):
    def test_local_renewal_question_scores_high(self):
        m = classify("Renewal offer from RBC, should I sign?",
                     "Our 5 year fixed mortgage is up. We live in Whitby.")
        self.assertIn("renewal", m.intents)
        self.assertTrue(m.local)
        self.assertGreaterEqual(m.score, 70)

    def test_us_post_penalised(self):
        m = classify("Best FHA lender in Durham?", "Need a mortgage, escrow question too?")
        self.assertLess(m.score, 45)

    def test_promo_skipped(self):
        m = classify("", "I'm a mortgage broker, DM me for rates")
        self.assertEqual(m.score, 0)
        self.assertTrue(m.skip_reason)

    def test_unrelated(self):
        self.assertEqual(classify("Transit", "Took the new line today?").score, 0)


class SourcesTest(unittest.TestCase):
    def test_reddit_listing(self):
        data = {"data": {"children": [
            {"data": {"id": "abc", "subreddit": "PersonalFinanceCanada", "title": "t", "selftext": "b",
                      "permalink": "/r/x/comments/abc/", "author": "u", "created_utc": 1.0}},
            {"data": {"id": "pin", "stickied": True}},
        ]}}
        posts = parse_reddit_listing(data)
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0].uid, "reddit:abc")
        self.assertEqual(posts[0].url, "https://www.reddit.com/r/x/comments/abc/")

    def test_rss_and_atom(self):
        rss = b"""<rss><channel><item><title>Break mortgage?</title><link>http://f/1</link>
                 <guid>g1</guid><description>&lt;p&gt;IRD penalty&lt;/p&gt;</description>
                 <pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>"""
        p = parse_feed(rss, "Forum")[0]
        self.assertEqual((p.post_id, p.body), ("g1", "IRD penalty"))
        atom = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>e1</id><title>Hi</title>
                  <link href="http://f/2"/><updated>2026-09-21T10:00:00Z</updated>
                  <content>renewal</content></entry></feed>"""
        p = parse_feed(atom, "Forum")[0]
        self.assertEqual((p.post_id, p.url), ("e1", "http://f/2"))

    def test_manual_ids_are_stable(self):
        a = load_manual_file(SAMPLE)
        b = load_manual_file(SAMPLE)
        self.assertEqual([p.uid for p in a], [p.uid for p in b])


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = store.connect(Path(self.tmp.name) / "a.db")
        self.cfg = json.loads(json.dumps(DEFAULT_CONFIG))

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_process_dedupes_and_filters(self):
        posts = load_manual_file(SAMPLE)
        new = process(self.conn, self.cfg, posts)
        self.assertEqual(len(new), 3)
        self.assertEqual(process(self.conn, self.cfg, posts), [])

    def test_old_posts_skipped(self):
        p = Post("reddit", "old", "r/x", "Renewal offer, should I sign? Whitby mortgage", "", "", "",
                 time.time() - 10 * 86400)
        self.assertEqual(process(self.conn, self.cfg, [p]), [])

    def test_offline_draft_status_and_digest(self):
        new = process(self.conn, self.cfg, load_manual_file(SAMPLE))
        uid = new[0]["uid"]
        d = draft(new[0], new[0]["intents"], {"disclosure": "(I'm a mortgage agent.)"}, offline=True)
        self.assertTrue(d.reply.endswith("(I'm a mortgage agent.)"))
        store.save_draft(self.conn, uid, d.__dict__)
        self.assertEqual(store.get(self.conn, uid)["status"], "drafted")
        self.assertTrue(store.set_status(self.conn, uid.split(":")[1], "replied"))
        out = Path(self.tmp.name) / "d.html"
        write_digest(store.listing(self.conn, statuses=list(store.STATUSES)), out)
        self.assertIn("Copy draft", out.read_text())


class ClaudeRequestTest(unittest.TestCase):
    def test_request_shape_and_parsing(self):
        payload = {"should_reply": True, "reason": "r", "reply": "hello", "follow_up_hint": "h"}
        client = mock.MagicMock()
        client.beta.messages.create.return_value = SimpleNamespace(
            stop_reason="end_turn", model="claude-opus-5",
            content=[SimpleNamespace(type="thinking"), SimpleNamespace(type="text", text=json.dumps(payload))])
        d = draft_with_claude(client, {"title": "t", "body": "b", "source": "reddit", "community": "r/x"},
                              ["renewal"], {"disclosure": "D"})
        self.assertEqual(d.reply, "hello")
        kwargs = client.beta.messages.create.call_args.kwargs
        self.assertEqual(kwargs["output_config"]["format"]["schema"], DRAFT_SCHEMA)
        self.assertEqual(kwargs["fallbacks"], "default")
        self.assertIn("Disclosure line to end with: D", kwargs["messages"][0]["content"])

    def test_refusal(self):
        client = mock.MagicMock()
        client.beta.messages.create.return_value = SimpleNamespace(stop_reason="refusal", model="m", content=[])
        d = draft_with_claude(client, {"title": "", "body": ""}, [], {})
        self.assertFalse(d.should_reply)


if __name__ == "__main__":
    unittest.main()
