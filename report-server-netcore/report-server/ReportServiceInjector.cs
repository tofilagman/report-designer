using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PuppeteerSharp;

namespace z.Report.Server;

public static class ReportServiceInjector
{
    public static void AddReport(this IServiceCollection services, Action<IServiceProvider, PdfRenderConfigurationToken> configure)
    {
        services.AddScoped<IPdfService, PdfService>();

        services.TryAdd(new ServiceDescriptor(typeof(PdfRenderConfigurationToken), provider =>
        {
            var option = new PdfRenderConfigurationToken();
            configure.Invoke(provider, option);
            return option;
        }, ServiceLifetime.Singleton));

    }

    public static async Task DownloadBrowser()
    {
        var browserFetcher = new BrowserFetcher();
        await browserFetcher.DownloadAsync();
    }
}
