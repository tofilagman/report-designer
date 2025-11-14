using System;

namespace z.Report.Server;

public class PdfRenderConfigurationToken
{
   /// <summary>
   /// location of js libraries
   /// </summary>
   public string LibsPath { get; set; }

   /// <summary>
   /// location of report files
   /// </summary>
   public string ReportPath { get; set; }

   /// <summary>
   /// location of json data for large dataset rendering
   /// </summary>
   public string DataPath { get; set; }
}
