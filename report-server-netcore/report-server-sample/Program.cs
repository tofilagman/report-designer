using Microsoft.AspNetCore.Mvc;
using report_server;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

//add report service
await builder.Services.AddReport((provider, options) =>
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

app.MapGet("/report/{template}", async ([FromRoute(Name = "token")] string token, [FromBody] string data) =>
{
    var pdfService = app.Services.GetRequiredService<IPdfService>();

    var pdfData = await pdfService.RenderData(token, data);
    var rData = Convert.ToBase64String(pdfData);

    return $"data:application/pdf;base64,{rData}";
});

app.Run();

