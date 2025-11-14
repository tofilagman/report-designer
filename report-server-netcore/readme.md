
## nuget publishing
```bash
$ cd report-server
$ dotnet build
$ dotnet pack --configuration Release
```

## integrate
nuget: z.Report.Server 1.0.0

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