using Microsoft.AspNetCore.Mvc;
using z.Data;
using z.Report.Server;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

//add report service
builder.Services.AddReport((provider, options) =>
{
  var pdfSection = builder.Configuration.GetSection("PdfRender");
  options.ReportPath = pdfSection.GetValue<string>("ReportPath") ?? "";
  options.LibsPath = pdfSection.GetValue<string>("LibsPath") ?? "";
  options.DataPath = pdfSection.GetValue<string>("DataPath") ?? "";
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

app.MapPost("/report/{template}", async ([FromRoute(Name = "template")] string template, [FromBody] object data) =>
{
    var pdfService = app.Services.GetRequiredService<IPdfService>();

    var mData = data.ToJson();
    var pdfData = await pdfService.RenderData(template, mData);
    var rData = Convert.ToBase64String(pdfData);

    return $"data:application/pdf;base64,{rData}";
});

//for server deployment, download browser once per needed
await ReportServiceInjector.DownloadBrowser();

app.Run();

