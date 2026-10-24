// C# 5 / .NET Framework 4.5+; no Node.js, NuGet, IIS or URL ACL required.
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Threading;
using System.Web;
using System.Web.Script.Serialization;

namespace NuvioLegacy {
    public static class Program {
        public static int Main(string[] args) {
            try {
                int port = args.Length == 0 ? 3147 : Int32.Parse(args[0]);
                var bridge = new AbyssBridge(Environment.GetEnvironmentVariable("ABYSS_PUBLIC_BASE"), Environment.GetEnvironmentVariable("ABYSS_BRIDGE_TOKEN"));
                Console.WriteLine("Legacy bridge listening on 127.0.0.1:" + port);
                bridge.Run(port);
                return 0;
            } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        }
    }
    public sealed class VideoSource {
        public string Label;
        public string Sub;
        public long Size;
        public int ResId;
    }
    public sealed class VideoMetadata {
        public string Slug;
        public long Md5Id;
        public List<VideoSource> Sources = new List<VideoSource>();
    }
    public sealed class ByteRange { public long Start; public long End; public bool Partial; }
    sealed class CachedMetadata { public VideoMetadata Value; public DateTime Expires; }

    public sealed class AbyssBridge {
        public const int SegmentSize = 2097152;
        const string Origin = "https://abyss.msmbot.club";
        readonly string publicBase;
        readonly string token;
        readonly byte[] secret = new byte[32];
        readonly ConcurrentDictionary<string, CachedMetadata> cache = new ConcurrentDictionary<string, CachedMetadata>();
        readonly SemaphoreSlim clients = new SemaphoreSlim(16);
        TcpListener listener;
        volatile bool running;
        static readonly Encoding Latin1 = Encoding.GetEncoding(28591);

        public AbyssBridge(string baseUrl, string accessToken) {
            Uri uri;
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out uri) ||
                !(uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback)) ||
                !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.Fragment) || !String.IsNullOrEmpty(uri.UserInfo))
                throw new ArgumentException("Use an HTTPS public base URL (or loopback HTTP for testing).");
            if (String.IsNullOrEmpty(accessToken) || accessToken.Length < 24) throw new ArgumentException("Bridge token must have at least 24 characters.");
            publicBase = baseUrl.TrimEnd('/');
            token = accessToken;
            using (RandomNumberGenerator random = RandomNumberGenerator.Create()) random.GetBytes(secret);
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            ServicePointManager.DefaultConnectionLimit = 20;
        }

        static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        static string Md5(byte[] bytes) { using (MD5 hash = MD5.Create()) return Hex(hash.ComputeHash(bytes)); }
        public static byte[] Transform(byte[] data, string hex) {
            byte[] key = Encoding.ASCII.GetBytes(hex);
            byte[] counter = new byte[16];
            Buffer.BlockCopy(key, 0, counter, 0, 16);
            byte[] output = new byte[data.Length], block = new byte[16];
            using (Aes aes = Aes.Create()) {
                aes.Mode = CipherMode.ECB; aes.Padding = PaddingMode.None; aes.Key = key;
                using (ICryptoTransform encryptor = aes.CreateEncryptor()) {
                    for (int offset = 0; offset < data.Length; offset += 16) {
                        encryptor.TransformBlock(counter, 0, 16, block, 0);
                        for (int i = 0; i < Math.Min(16, data.Length - offset); i++) output[offset + i] = (byte)(data[offset + i] ^ block[i]);
                        for (int i = 15; i >= 0; i--) { counter[i]++; if (counter[i] != 0) break; }
                    }
                }
            }
            return output;
        }
        public static VideoMetadata ParseMetadata(string html) {
            Match match = Regex.Match(html, "const\\s+datas\\s*=\\s*[\"']([^\"']+)[\"']");
            if (!match.Success || match.Groups[1].Length > 500000) throw new InvalidDataException("Abyss metadata unavailable.");
            JavaScriptSerializer json = new JavaScriptSerializer();
            var data = (Dictionary<string, object>)json.DeserializeObject(Latin1.GetString(Convert.FromBase64String(match.Groups[1].Value)));
            string slug = Convert.ToString(data["slug"]);
            long id = Convert.ToInt64(data["md5_id"]);
            string key = Md5(Encoding.UTF8.GetBytes(data["user_id"] + ":" + slug + ":" + id));
            string decrypted = Encoding.UTF8.GetString(Transform(Latin1.GetBytes((string)data["media"]), key));
            var payload = (Dictionary<string, object>)json.DeserializeObject(decrypted);
            var mp4 = (Dictionary<string, object>)payload["mp4"];
            var domains = (object[])mp4["domains"];
            if (domains.Length == 0 || !Regex.IsMatch(Convert.ToString(domains[0]), "^[a-z0-9-]+\\.sssrr\\.org$", RegexOptions.IgnoreCase))
                throw new InvalidDataException("Unsupported CDN.");
            var result = new VideoMetadata {Slug = slug, Md5Id = id};
            foreach (object item in (IEnumerable)mp4["sources"]) {
                var source = (Dictionary<string, object>)item;
                long size = Convert.ToInt64(source["size"]);
                string sub = Convert.ToString(source["sub"]);
                int resId = Convert.ToInt32(source["res_id"]);
                if (!Convert.ToBoolean(source["status"]) || size <= 0 || size > 100L * 1024 * 1024 * 1024 ||
                    resId < 0 || !Regex.IsMatch(sub, "^[a-z0-9-]+$", RegexOptions.IgnoreCase)) continue;
                result.Sources.Add(new VideoSource {Label = Convert.ToString(source["label"]), Sub = sub, Size = size, ResId = resId});
            }
            return result;
        }
        public static string SegmentUrl(VideoMetadata metadata, VideoSource source, long index) {
            byte[] digits = Encoding.ASCII.GetBytes(source.Size.ToString(System.Globalization.CultureInfo.InvariantCulture));
            for (int i = 0; i < digits.Length; i++) digits[i] -= 48;
            string path = "/mp4/" + metadata.Md5Id + "/" + source.ResId + "/" + source.Size + "/" + SegmentSize + "/" + index;
            string first = Convert.ToBase64String(Transform(Encoding.UTF8.GetBytes(path), Md5(digits))).TrimEnd('=');
            string encoded = Convert.ToBase64String(Encoding.ASCII.GetBytes(first)).TrimEnd('=');
            return "https://" + source.Sub + ".sssrr.org/sora/" + source.Size + "/" + encoded;
        }
        public static ByteRange ParseRange(string header, long size) {
            if (String.IsNullOrEmpty(header)) return new ByteRange {Start = 0, End = size - 1, Partial = false};
            Match match = Regex.Match(header, "^bytes=(\\d*)-(\\d*)$");
            long start, end;
            if (!match.Success || (match.Groups[1].Length == 0 && match.Groups[2].Length == 0)) throw new InvalidDataException("Invalid range.");
            if (match.Groups[1].Length == 0) {
                long suffix = Int64.Parse(match.Groups[2].Value);
                if (suffix < 1) throw new InvalidDataException("Invalid suffix.");
                start = Math.Max(0, size - suffix); end = size - 1;
            } else {
                start = Int64.Parse(match.Groups[1].Value);
                end = match.Groups[2].Length == 0 ? size - 1 : Math.Min(Int64.Parse(match.Groups[2].Value), size - 1);
            }
            if (start < 0 || start >= size || end < start) throw new InvalidDataException("Range outside file.");
            return new ByteRange {Start = start, End = end, Partial = true};
        }

        static HttpWebRequest Upstream(string url) {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.UserAgent = "Mozilla/5.0";
            request.Referer = "https://pencurimoviesubmalay26.site/";
            request.Timeout = 30000; request.ReadWriteTimeout = 30000;
            request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            return request;
        }
        VideoMetadata Metadata(string slug) {
            CachedMetadata entry;
            if (cache.TryGetValue(slug, out entry) && entry.Expires > DateTime.UtcNow) return entry.Value;
            var request = Upstream(Origin + "/?v=" + Uri.EscapeDataString(slug));
            string html;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var memory = new MemoryStream()) {
                byte[] buffer = new byte[8192]; int read;
                while ((read = stream.Read(buffer, 0, buffer.Length)) != 0) {
                    if (memory.Length + read > 1000000) throw new InvalidDataException("Metadata too large.");
                    memory.Write(buffer, 0, read);
                }
                html = Encoding.UTF8.GetString(memory.ToArray());
            }
            var metadata = ParseMetadata(html);
            if (metadata.Slug != slug) throw new InvalidDataException("Video identity mismatch.");
            if (cache.Count >= 100) cache.Clear();
            cache[slug] = new CachedMetadata {Value = metadata, Expires = DateTime.UtcNow.AddMinutes(5)};
            return metadata;
        }
        string Sign(string path, string expires) {
            using (var hmac = new HMACSHA256(secret)) return Hex(hmac.ComputeHash(Encoding.UTF8.GetBytes(path + ":" + expires)));
        }
        static bool Equal(string a, string b) {
            byte[] left = Encoding.UTF8.GetBytes(a ?? ""), right = Encoding.UTF8.GetBytes(b ?? "");
            if (left.Length != right.Length) return false;
            int different = 0;
            for (int i = 0; i < left.Length; i++) different |= left[i] ^ right[i];
            return different == 0;
        }
        static long UnixNow() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds; }
        static void Headers(Stream output, int status, string type, long length, string extra) {
            string reason = status == 200 ? "OK" : status == 206 ? "Partial Content" : "Error";
            string text = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + length +
                "\r\nConnection: close\r\nCache-Control: private, no-store\r\nAccess-Control-Allow-Origin: *\r\n" + extra + "\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(text); output.Write(bytes, 0, bytes.Length);
        }
        static void Json(Stream output, int status, object value, bool head) {
            byte[] bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value));
            Headers(output, status, "application/json", bytes.Length, "");
            if (!head) output.Write(bytes, 0, bytes.Length);
        }
        void Handle(TcpClient client) {
            bool headersSent = false;
            using (client) {
                client.ReceiveTimeout = 15000; client.SendTimeout = 30000; client.NoDelay = true;
                using (NetworkStream output = client.GetStream()) {
                    try {
                        var raw = new StringBuilder();
                        while (raw.Length < 16384) {
                            int next = output.ReadByte(); if (next < 0) return; raw.Append((char)next);
                            if (raw.Length >= 4 && raw.ToString(raw.Length - 4, 4) == "\r\n\r\n") break;
                        }
                        if (raw.Length >= 16384) { Json(output, 431, new {error = "Headers too large"}, false); return; }
                        string[] lines = raw.ToString().Split(new string[] {"\r\n"}, StringSplitOptions.None);
                        string[] first = lines[0].Split(' ');
                        if (first.Length != 3 || !first[1].StartsWith("/")) { Json(output, 400, new {error = "Invalid request"}, false); return; }
                        bool head = first[0] == "HEAD";
                        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        for (int i = 1; i < lines.Length; i++) {
                            int colon = lines[i].IndexOf(':'); if (colon > 0) {
                                string name = lines[i].Substring(0, colon).Trim();
                                if (headers.ContainsKey(name)) { Json(output, 400, new {error = "Duplicate header"}, head); return; }
                                headers[name] = lines[i].Substring(colon + 1).Trim();
                            }
                        }
                        if (first[0] == "OPTIONS") { Headers(output, 204, "text/plain", 0, "Access-Control-Allow-Headers: Authorization, Range\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n"); return; }
                        if (first[0] != "GET" && !head) { Json(output, 405, new {error = "Method not allowed"}, head); return; }
                        Uri url = new Uri("http://localhost" + first[1]);
                        var query = HttpUtility.ParseQueryString(url.Query);
                        if (url.AbsolutePath == "/health") { Json(output, 200, new {ok = true, service = "nuvio-abyss-bridge", runtime = "net-framework"}, head); return; }
                        if (url.AbsolutePath == "/resolve") {
                            string authorization;
                            if (!headers.TryGetValue("Authorization", out authorization) || !Equal(authorization, "Bearer " + token)) { Json(output, 401, new {error = "Unauthorized"}, head); return; }
                            string slug = query["v"] ?? "";
                            if (!Regex.IsMatch(slug, "^[a-zA-Z0-9_-]{1,80}$")) { Json(output, 400, new {error = "Invalid video ID"}, head); return; }
                            VideoMetadata metadata = Metadata(slug);
                            string expires = (UnixNow() + 21600).ToString();
                            var streams = new List<object>();
                            foreach (var source in metadata.Sources) {
                                string path = "/stream/" + slug + "/" + source.ResId + ".mp4";
                                streams.Add(new {url = publicBase + path + "?expires=" + expires + "&sig=" + Sign(path, expires), quality = source.Label, size = source.Size});
                            }
                            Json(output, 200, new {streams = streams}, head); return;
                        }
                        Match match = Regex.Match(url.AbsolutePath, "^/stream/([a-zA-Z0-9_-]{1,80})/(\\d+)\\.mp4$");
                        if (!match.Success) { Json(output, 404, new {error = "Not found"}, head); return; }
                        string expiry = query["expires"] ?? ""; long expiryValue;
                        if (!Int64.TryParse(expiry, out expiryValue) || expiryValue < UnixNow() || !Equal(query["sig"], Sign(url.AbsolutePath, expiry))) { Json(output, 403, new {error = "Invalid or expired link"}, head); return; }
                        VideoMetadata media = Metadata(match.Groups[1].Value);
                        int resolution = Int32.Parse(match.Groups[2].Value);
                        VideoSource chosen = media.Sources.Find(s => s.ResId == resolution);
                        if (chosen == null) { Json(output, 404, new {error = "Resolution unavailable"}, head); return; }
                        string rangeHeader; headers.TryGetValue("Range", out rangeHeader);
                        ByteRange range;
                        try { range = ParseRange(rangeHeader, chosen.Size); }
                        catch { Headers(output, 416, "text/plain", 0, "Content-Range: bytes */" + chosen.Size + "\r\n"); return; }
                        string extra = "Accept-Ranges: bytes\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n";
                        if (range.Partial) extra += "Content-Range: bytes " + range.Start + "-" + range.End + "/" + chosen.Size + "\r\n";
                        if (head) { Headers(output, range.Partial ? 206 : 200, "video/mp4", range.End - range.Start + 1, extra); return; }
                        long cursor = range.Start;
                        while (cursor <= range.End) {
                            long index = cursor / SegmentSize;
                            long start = cursor - index * SegmentSize;
                            long end = Math.Min(range.End, (index + 1) * SegmentSize - 1);
                            long localEnd = end - index * SegmentSize;
                            var request = Upstream(SegmentUrl(media, chosen, index));
                            request.Referer = Origin + "/?v=" + media.Slug;
                            request.AddRange(start, localEnd);
                            using (var response = (HttpWebResponse)request.GetResponse()) {
                                string actual = response.Headers["Content-Range"] ?? "";
                                if ((int)response.StatusCode != 206 || !actual.StartsWith("bytes " + start + "-" + localEnd + "/")) throw new InvalidDataException("Invalid upstream range.");
                                if (!headersSent) { Headers(output, range.Partial ? 206 : 200, "video/mp4", range.End - range.Start + 1, extra); headersSent = true; }
                                using (var input = response.GetResponseStream()) {
                                    byte[] buffer = new byte[65536]; long remaining = localEnd - start + 1;
                                    while (remaining > 0) {
                                        int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                                        if (read == 0) throw new EndOfStreamException("Incomplete upstream range.");
                                        output.Write(buffer, 0, read); remaining -= read;
                                    }
                                }
                            }
                            cursor = end + 1;
                        }
                    } catch {
                        if (!headersSent) { try { Json(output, 502, new {error = "Abyss is temporarily unavailable"}, false); } catch {} }
                    }
                }
            }
        }
        public void Run(int port) {
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start(); running = true;
            while (running) {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); } catch { if (!running) return; throw; }
                if (!clients.Wait(0)) { client.Close(); continue; }
                ThreadPool.QueueUserWorkItem(delegate { try { Handle(client); } finally { clients.Release(); } });
            }
        }
        public void Stop() { running = false; if (listener != null) listener.Stop(); }
    }
}
