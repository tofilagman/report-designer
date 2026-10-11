using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace z.Report.Server;

/// <summary>
/// Connection settings for a remote report server (the Kotlin report-server).
/// </summary>
public class ReportServerOptions
{
    /// <summary>Base URL of the report server, e.g. https://reports.example.com</summary>
    public string Url { get; set; } = "";

    /// <summary>
    /// The server's REPORT_SERVER_KEY, sent as <c>Authorization: Bearer</c>. Leave empty only for
    /// a server running without a key.
    /// </summary>
    public string? Key { get; set; }

    /// <summary>Per-request timeout; rendering large reports can take a while.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(120);
}

/// <summary>A report server answered with an error.</summary>
public class ReportServerException : Exception
{
    public HttpStatusCode StatusCode { get; }

    public ReportServerException(HttpStatusCode statusCode, string message) : base(message)
    {
        StatusCode = statusCode;
    }
}

/// <summary>
/// Renders published templates on a remote report server instead of running Chrome in this
/// process. Templates and libraries are published to the server from the VS Code extension.
/// </summary>
public interface IReportServerClient
{
    /// <summary>Renders <paramref name="templateName"/> (without .zrpt) with raw JSON data and returns the PDF.</summary>
    Task<byte[]> RenderPdf(string templateName, string jsonData, CancellationToken cancellationToken = default);

    /// <summary>Renders <paramref name="templateName"/> with <paramref name="data"/> serialized as JSON.</summary>
    Task<byte[]> RenderPdf<T>(string templateName, T data, CancellationToken cancellationToken = default);
}

public class ReportServerClient : IReportServerClient
{
    public const int MinKeyLength = 32;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient http;

    public ReportServerClient(HttpClient http)
    {
        this.http = http;
    }

    public async Task<byte[]> RenderPdf(string templateName, string jsonData, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(templateName))
            throw new ArgumentException("Template name is required", nameof(templateName));

        var path = $"render/pdf/{Uri.EscapeDataString(templateName)}";
        using var content = new StringContent(jsonData, Encoding.UTF8, "application/json");
        using var response = await http.PostAsync(path, content, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new ReportServerException(response.StatusCode, Describe(response.StatusCode, body, templateName));
        }
        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    public Task<byte[]> RenderPdf<T>(string templateName, T data, CancellationToken cancellationToken = default) =>
        RenderPdf(templateName, JsonSerializer.Serialize(data, JsonOptions), cancellationToken);

    private string Describe(HttpStatusCode status, string body, string templateName)
    {
        var server = http.BaseAddress?.ToString().TrimEnd('/') ?? "the report server";
        var detail = body.Length > 500 ? body[..500] : body;
        return status switch
        {
            HttpStatusCode.Unauthorized when http.DefaultRequestHeaders.Authorization is null =>
                $"{server} requires an API key; set ReportServerOptions.Key to its REPORT_SERVER_KEY",
            HttpStatusCode.Unauthorized =>
                $"{server} rejected the API key ({detail}); check ReportServerOptions.Key",
            _ => $"{server} could not render '{templateName}' ({(int)status}): {detail}",
        };
    }

    /// <summary>Applies options to the typed HttpClient; validates them so mistakes fail at startup.</summary>
    internal static void Configure(HttpClient http, ReportServerOptions options)
    {
        if (!Uri.TryCreate(options.Url, UriKind.Absolute, out var url) || (url.Scheme != "http" && url.Scheme != "https"))
            throw new InvalidOperationException($"ReportServerOptions.Url must be an http(s) URL, got '{options.Url}'");

        // A trailing slash makes relative paths like "render/pdf/x" resolve under any base path.
        http.BaseAddress = new Uri(url.ToString().TrimEnd('/') + "/");
        http.Timeout = options.Timeout;

        var key = options.Key?.Trim();
        if (!string.IsNullOrEmpty(key))
        {
            if (key.Length < MinKeyLength || key.Any(char.IsWhiteSpace))
                throw new InvalidOperationException(
                    $"ReportServerOptions.Key must be at least {MinKeyLength} characters with no spaces, like the server's REPORT_SERVER_KEY");
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        }
    }
}

public static class ReportServerClientInjector
{
    /// <summary>
    /// Registers <see cref="IReportServerClient"/> for rendering on a remote report server.
    /// <code>
    /// builder.Services.AddReportServerClient(o =>
    /// {
    ///     o.Url = builder.Configuration["ReportServer:Url"]!;
    ///     o.Key = builder.Configuration["ReportServer:Key"];   // e.g. env ReportServer__Key
    /// });
    /// </code>
    /// </summary>
    public static IHttpClientBuilder AddReportServerClient(this IServiceCollection services, Action<ReportServerOptions> configure)
    {
        services.AddOptions<ReportServerOptions>().Configure(configure);
        return services.AddHttpClient<IReportServerClient, ReportServerClient>((provider, http) =>
            ReportServerClient.Configure(http, provider.GetRequiredService<IOptions<ReportServerOptions>>().Value));
    }
}
