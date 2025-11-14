using System;

namespace report_server;

public class PdfRenderToken
{
    public string Name { get; set; }
    public bool Landscape { get; set; }
    public string DocumentType { get; set; }
    public string Code { get; set; }
    public string? Data { get; set; }
    public string? Style { get; set; }
    public string? Script { get; set; }
    public PdfMarginToken Margin { get; set; }
    public List<PdfAssetToken> Assets { get; set; }
}

public class PdfMarginToken
{
    public string Top { get; set; }
    public string Left { get; set; }
    public string Right { get; set; }
    public string Bottom { get; set; }
}

public class PdfAssetToken
{
    public string Id { get; set; }
    public string Data { get; set; }
}