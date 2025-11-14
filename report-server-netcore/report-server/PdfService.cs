using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Bson;
using PuppeteerSharp;
using PuppeteerSharp.Media;
using z.Data;

namespace z.Report.Server;
 
public class PdfService : IPdfService
{ 
    private readonly StringLoggerFactory loggerFactory;
    private readonly ILogger<PdfService> logger;
    private readonly ILoggerFactory factory;
    private readonly PdfRenderConfigurationToken configurationToken;
 
    public PdfService(PdfRenderConfigurationToken configurationToken)
    {
        this.configurationToken = configurationToken;

        loggerFactory = new StringLoggerFactory();
        factory = loggerFactory.CreateStringLogger();
        logger = factory.CreateLogger<PdfService>();
    }

    private const string default_style = @"
                body {
                    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;
                } 
            ";

    public async Task<byte[]> Render(string templateName, string dataId)
    {
        var data = Path.Combine(configurationToken.DataPath, dataId);
        if (!File.Exists(data))
            throw new Exception("Requested data doesn't exists");

        return await RenderData(templateName, File.ReadAllText(data));
    }

    public async Task<byte[]> RenderData(string templateName, string data)
    {
        var template = Path.Combine(configurationToken.ReportPath, $"{templateName}.zrpt");
        if (!File.Exists(template))
            throw new Exception("Requested template doesn't exists");

        var nd = await File.ReadAllBytesAsync(template);
        using var ms = new MemoryStream(nd);
        //need to update z.Data.Standard for latest Newtonsoft.Json package
        using var reader = new BsonReader(ms);
        var serializer = new JsonSerializer();
        var tmpl = serializer.Deserialize<PdfRenderToken>(reader) ?? throw new Exception("Could not read report template");

        return await Plot(tmpl, data);
    }

    private async Task<byte[]> Plot(PdfRenderToken token, string data)
    {
        try
        {
            logger.LogInformation("Starting Browser");
            await using var browser = await Puppeteer.LaunchAsync(new LaunchOptions { Headless = true, Args = ["--no-sandbox"] }, factory);

            await using var page = await browser.NewPageAsync();

            await page.SetContentAsync($@"
                    <style id='def-style'>
                        {default_style}
                    </style>
                    <body></body>
                ");

            await page.AddScriptTagAsync(new AddTagOptions
            {
                Id = "entry-template",
                Type = "text/x-handlebars-template",
                Content = token.Code
            });

            if (!string.IsNullOrEmpty(token.Style))
                await page.AddScriptTagAsync(new AddTagOptions
                {
                    Id = "style-template",
                    Type = "text/x-handlebars-template",
                    Content = token.Style
                });

            var libs = Directory.GetFiles(configurationToken.LibsPath, "*.js");
            foreach (var lib in libs.Where(x => Path.GetFileName(x).ToLower() != "processor.js"))
            {
                await page.AddScriptTagAsync(new AddTagOptions
                {
                    Type = "text/javascript",
                    Content = File.ReadAllText(lib)
                });
            }

            if (!string.IsNullOrEmpty(token.Data))
                await page.AddScriptTagAsync(new AddTagOptions
                {
                    Type = "text/javascript",
                    Content = $@"window.processContext = {data}"
                });

            if (token.Assets.Any())
            {
                var assets = token.Assets.ToPair(x => x.Id, x => x.Data);

                await page.AddScriptTagAsync(new AddTagOptions
                {
                    Type = "text/javascript",
                    Content = $@"window.resourceContext = {assets.ToJson()}"
                });
            }


            if (!string.IsNullOrWhiteSpace(token.Script))
                await page.AddScriptTagAsync(new AddTagOptions
                {
                    Type = "text/javascript",
                    Content = token.Script
                });

            var processor = libs.SingleOrDefault(x => Path.GetFileName(x).ToLower() == "processor.js") ?? throw new Exception("Processor.js could not be found");
            await page.AddScriptTagAsync(new AddTagOptions
            {
                Type = "text/javascript",
                Content = File.ReadAllText(processor)
            });

            await page.SetViewportAsync(new ViewPortOptions { DeviceScaleFactor = 1.0 });
            await page.SetJavaScriptEnabledAsync(true);
            await page.EvaluateExpressionHandleAsync("document.fonts.ready");

            await page.EvaluateFunctionAsync("() => window.processHandlebar()");

            logger.LogInformation("Rendering PDF");

            var dataByte = await page.PdfDataAsync(new PdfOptions
            {
                Format = ToDocType(token.DocumentType),
                Landscape = token.Landscape,
                PrintBackground = true,
                PreferCSSPageSize = true,
                Scale = 1.0M,
                MarginOptions = new MarginOptions
                {
                    Top = token.Margin.Top,
                    Left = token.Margin.Left,
                    Right = token.Margin.Right,
                    Bottom = token.Margin.Bottom
                },
                HeaderTemplate = "",
                FooterTemplate = ""
            });

            await browser.CloseAsync();

            return dataByte;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, ex.Message);
            throw new Exception(loggerFactory.ToString(LogLevel.Information));
        }
    }

    private PaperFormat ToDocType(string value)
    {
        switch (value.ToLower())
        {
            case "a0": return PaperFormat.A0;
            case "a1": return PaperFormat.A1;
            case "a2": return PaperFormat.A2;
            case "a3": return PaperFormat.A3;
            case "a4": return PaperFormat.A4;
            case "a5": return PaperFormat.A5;
            case "a6": return PaperFormat.A6;
            case "letter": return PaperFormat.Letter;
            case "legal": return PaperFormat.Legal;
            case "tabloid": return PaperFormat.Tabloid;
            case "ledger": return PaperFormat.Ledger;
        }
        return PaperFormat.A4;
    }
}
