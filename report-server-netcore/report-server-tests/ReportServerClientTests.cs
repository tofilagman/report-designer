using System.Net;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using z.Report.Server;

namespace report_server_tests;

/// <summary>Records requests and answers with a canned response.</summary>
class FakeHandler(HttpStatusCode status = HttpStatusCode.OK, string body = "%PDF-1.4 fake") : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var content = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request, content));
        return new HttpResponseMessage(status) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)) };
    }
}

public class ReportServerClientTests
{
    private static readonly string Key = new('k', 64);

    private static (IReportServerClient Client, FakeHandler Handler) Create(
        string url, string? key, HttpStatusCode status = HttpStatusCode.OK, string body = "%PDF-1.4 fake")
    {
        var handler = new FakeHandler(status, body);
        var services = new ServiceCollection();
        services.AddReportServerClient(o =>
        {
            o.Url = url;
            o.Key = key;
        }).ConfigurePrimaryHttpMessageHandler(() => handler);
        return (services.BuildServiceProvider().GetRequiredService<IReportServerClient>(), handler);
    }

    [Fact]
    public async Task Sends_the_key_as_a_bearer_token_and_posts_json_to_render_pdf()
    {
        var (client, handler) = Create("https://reports.example.com", Key);

        var pdf = await client.RenderPdf("invoice", """{"number":"INV-1"}""");

        Assert.Equal("%PDF-1.4 fake", Encoding.UTF8.GetString(pdf));
        var (request, body) = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://reports.example.com/render/pdf/invoice", request.RequestUri!.ToString());
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal(Key, request.Headers.Authorization.Parameter);
        Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);
        Assert.Equal("""{"number":"INV-1"}""", body);
    }

    [Fact]
    public async Task Typed_data_is_serialized_as_camel_case_json()
    {
        var (client, handler) = Create("https://reports.example.com", Key);

        await client.RenderPdf("invoice", new { Number = "INV-1", Items = new[] { new { Name = "Widget" } } });

        Assert.Equal("""{"number":"INV-1","items":[{"name":"Widget"}]}""", handler.Requests[0].Body);
    }

    [Fact]
    public async Task Works_behind_a_base_path_and_escapes_template_names()
    {
        var (client, handler) = Create("https://host.example.com/reports/", Key);

        await client.RenderPdf("sales summary", "{}");

        Assert.Equal("https://host.example.com/reports/render/pdf/sales%20summary", handler.Requests[0].Request.RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task Without_a_key_no_authorization_header_is_sent()
    {
        var (client, handler) = Create("http://localhost:8088", null);

        await client.RenderPdf("invoice", "{}");

        Assert.Null(handler.Requests[0].Request.Headers.Authorization);
    }

    [Fact]
    public async Task A_401_says_whether_the_key_is_missing_or_wrong()
    {
        var (noKey, _) = Create("http://localhost:8088", null, HttpStatusCode.Unauthorized, "Missing API key");
        var missing = await Assert.ThrowsAsync<ReportServerException>(() => noKey.RenderPdf("invoice", "{}"));
        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        Assert.Contains("requires an API key", missing.Message);

        var (wrongKey, _) = Create("http://localhost:8088", Key, HttpStatusCode.Unauthorized, "Invalid API key");
        var wrong = await Assert.ThrowsAsync<ReportServerException>(() => wrongKey.RenderPdf("invoice", "{}"));
        Assert.Contains("rejected the API key (Invalid API key)", wrong.Message);
    }

    [Fact]
    public async Task Other_errors_carry_the_status_and_server_message()
    {
        var (client, _) = Create("http://localhost:8088", Key, HttpStatusCode.InternalServerError, "Requested template doesn't exists");
        var ex = await Assert.ThrowsAsync<ReportServerException>(() => client.RenderPdf("nope", "{}"));
        Assert.Equal(HttpStatusCode.InternalServerError, ex.StatusCode);
        Assert.Contains("could not render 'nope' (500): Requested template doesn't exists", ex.Message);
    }

    [Theory]
    [InlineData("http://localhost:8088", "too-short")]
    [InlineData("http://localhost:8088", "has spaces has spaces has spaces has spaces")]
    [InlineData("localhost:8088", null)]
    [InlineData("ftp://localhost", null)]
    public void Bad_settings_fail_when_the_client_is_created(string url, string? key)
    {
        Assert.Throws<InvalidOperationException>(() => Create(url, key));
    }
}

/// <summary>
/// Runs against a real report server when REPORT_SERVER_URL, REPORT_SERVER_KEY and
/// REPORT_SERVER_TEMPLATE are set (the template must already be published); otherwise no-op.
/// </summary>
public class ReportServerIntegrationTests
{
    [Fact]
    public async Task Renders_a_published_template_on_a_real_server()
    {
        var url = Environment.GetEnvironmentVariable("REPORT_SERVER_URL");
        var key = Environment.GetEnvironmentVariable("REPORT_SERVER_KEY");
        var template = Environment.GetEnvironmentVariable("REPORT_SERVER_TEMPLATE");
        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(template)) return;

        var services = new ServiceCollection();
        services.AddReportServerClient(o => { o.Url = url; o.Key = key; });
        var client = services.BuildServiceProvider().GetRequiredService<IReportServerClient>();

        var data = new { number = "INV-NET", customer = "Acme", total = "9.00", items = new[] { new { name = "Widget", qty = 1, price = "9.00" } } };
        var pdf = await client.RenderPdf(template, data);
        Assert.Equal("%PDF-", Encoding.ASCII.GetString(pdf, 0, 5));
        File.WriteAllBytes(Path.Combine(Path.GetTempPath(), "report-server-client-test.pdf"), pdf);

        // The same server must refuse a client with the wrong key.
        var wrong = new ServiceCollection();
        wrong.AddReportServerClient(o => { o.Url = url; o.Key = new string('0', 64); });
        var bad = wrong.BuildServiceProvider().GetRequiredService<IReportServerClient>();
        var ex = await Assert.ThrowsAsync<ReportServerException>(() => bad.RenderPdf(template, data));
        Assert.Equal(HttpStatusCode.Unauthorized, ex.StatusCode);
    }
}
