
## nuget publishing
```bash
$ cd report-server
$ dotnet build
$ dotnet pack --configuration Release
```

## integrate
nuget: z.Report.Server 1.1.0

## add report service
```c#
builder.Services.AddReport((provider, options) =>
{
  var pdfSection = builder.Configuration.GetSection("PdfRender");
  options.ReportPath = pdfSection.GetValue<string>("ReportPath") ?? "";
  options.LibsPath = pdfSection.GetValue<string>("LibsPath") ?? "";
  options.DataPath = pdfSection.GetValue<string>("DataPath") ?? "";
});
```

## download browser on application ready
```c#
//for server deployment, download browser once per needed
Console.WriteLine("Downloading Browser");
await ReportServiceInjector.DownloadBrowser();
Console.WriteLine("Downloading Browser Completed");
```

## call from Service or Controller
```c#
  //inject
  private readonly PdfService pdfService;  

  /// code blocks
  /// template          = YourAwesomeReportName
  /// rawRequestBody    = Json Data
  /// 
  var pdfData = await pdfService.RenderData(template, rawRequestBody);
  var rData = Convert.ToBase64String(pdfData);

  return $"data:application/pdf;base64,{rData}";
```
## render on a report server (with API key)
Instead of running Chrome inside your app, call a deployed report server. Templates and
libraries are published to it from the VS Code extension.

```c#
builder.Services.AddReportServerClient(options =>
{
  options.Url = builder.Configuration["ReportServer:Url"]!;   // e.g. https://reports.example.com
  options.Key = builder.Configuration["ReportServer:Key"];    // the server's REPORT_SERVER_KEY
});
```

Keep the key out of `appsettings.json`: set it with the `ReportServer__Key` environment
variable or user secrets. The key must be at least 32 characters, like the server's; a bad
URL or key fails when the client is first created.

```c#
  //inject IReportServerClient
  var pdf = await reportServer.RenderPdf("invoice", new { number = "INV-1", items });
  //or raw JSON
  var pdf = await reportServer.RenderPdf("invoice", jsonString);
```

`ReportServerException.StatusCode` is `401` when the key is missing or wrong; the message
says which.

## tests
```bash
dotnet test
# also run against a real server with a published template:
REPORT_SERVER_URL=http://localhost:8088 REPORT_SERVER_KEY=<key> REPORT_SERVER_TEMPLATE=invoice dotnet test
```
