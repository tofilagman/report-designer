using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PuppeteerSharp;

namespace report_server;

public static class ReportServiceInjector
{
    public static async Task AddReport(this IServiceCollection services, Action<IServiceProvider, PdfRenderConfigurationToken> configure)
    {
        var browserFetcher = new BrowserFetcher();
        await browserFetcher.DownloadAsync();

        services.AddSingleton<IPdfService, PdfService>();

        services.TryAdd(new ServiceDescriptor(typeof(PdfRenderConfigurationToken), provider =>
        {
            var option = new PdfRenderConfigurationToken();
            configure.Invoke(provider, option);
            return option;
        }, ServiceLifetime.Singleton));

    }
}
