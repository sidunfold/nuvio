using System;
using NuvioLegacy;
public static class NuvioLegacyTests {
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    public static int Main() {
        try {
            var range = AbyssBridge.ParseRange("bytes=2-8", 11);
            Check(range.Start == 2 && range.End == 8 && range.Partial, "Exact range");
            range = AbyssBridge.ParseRange("bytes=-3", 11);
            Check(range.Start == 8 && range.End == 10, "Suffix range");
            range = AbyssBridge.ParseRange("bytes=5-", 11);
            Check(range.Start == 5 && range.End == 10, "Open range");
            foreach (string invalid in new string[] {"bytes=99-", "bytes=8-2", "bytes=0-2,4-6", "bytes=-0"}) {
                bool rejected = false; try { AbyssBridge.ParseRange(invalid, 11); } catch { rejected = true; }
                Check(rejected, "Invalid range must be rejected: " + invalid);
            }
            const string encoded = "eyJ1c2VyX2lkIjoxLCJzbHVnIjoiZml4dHVyZSIsIm1kNV9pZCI6NDIsIm1lZGlhIjoi06eqXHUwMDE13UWUqbxSw5dYorffhL6VX1x1MDAxOHNLV7epgv/+aDqJ++FcdTAwMGZZgbGfoFx1MDAxZD7sXG57JZD5dZu5zUlSLccqaKmXu1x1MDAxYkjAllx1MDAxMUdcIlQyMTZatNWUbe/GY7DcJOk6N+ktW/uFxZkt7FFgvnSJMVJcdTAwMTIyTzNTOFxc71U0hVx1MDAxM13NSlx1MDAxMyJ9";
            var meta = AbyssBridge.ParseMetadata("<script>const datas=\"" + encoded + "\";</script>");
            Check(meta.Slug == "fixture" && meta.Md5Id == 42 && meta.Sources.Count == 1, "Metadata identity");
            Check(meta.Sources[0].Label == "1080p" && meta.Sources[0].Size == 11, "Metadata sources");
            string url = AbyssBridge.SegmentUrl(meta, meta.Sources[0], 2);
            Check(url == "https://fixture.sssrr.org/sora/11/d25PODBZL0JrbFU0Rm5saW13QUVBTnFkWU8zNWRn", "Segment signing must match Node implementation");
            bool badToken = false; try { new AbyssBridge("https://bridge.example", "short"); } catch { badToken = true; }
            Check(badToken, "Short token rejection");
            bool badUrl = false; try { new AbyssBridge("http://public.example", new string('a', 32)); } catch { badUrl = true; }
            Check(badUrl, "Remote cleartext URL rejection");
            Console.WriteLine("PASS: .NET Framework ranges, metadata decryption, Node-compatible segment signing and configuration validation");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
