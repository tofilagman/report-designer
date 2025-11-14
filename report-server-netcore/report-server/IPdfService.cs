using System;

namespace z.Report.Server;

public interface IPdfService
{
     Task<byte[]> Render(string templateName, string dataId);
     Task<byte[]> RenderData(string templateName, string data);
}
