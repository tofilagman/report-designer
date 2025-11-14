using System;

namespace report_server;

public interface IPdfService
{
     Task<byte[]> Render(string templateName, string dataId);
     Task<byte[]> RenderData(string templateName, string data);
}
