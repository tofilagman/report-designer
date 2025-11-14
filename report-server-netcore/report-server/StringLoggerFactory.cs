using System;
using Microsoft.Extensions.Logging;
using z.Data;

namespace report_server;

 public class StringLoggerProvider : ILoggerProvider
    {
        private readonly IList<LogHolder> stringBuilder ;

        public StringLoggerProvider(IList<LogHolder> stringBuilder)
        {
            this.stringBuilder = stringBuilder;
        }

        public ILogger CreateLogger(string categoryName)
        {
            return new StringLogger(stringBuilder);
        }

        public void Dispose()
        {

        }
    }

    public class StringLogger : ILogger
    {
        private readonly IList<LogHolder> stringBuilder;

        public StringLogger(IList<LogHolder> stringBuilder)
        {
            this.stringBuilder = stringBuilder;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
        {
            return null;
        }

        public bool IsEnabled(LogLevel logLevel)
        {
            return true;
        }

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            stringBuilder.Add(new LogHolder { 
                LogLevel = logLevel, 
                Message = formatter(state, exception) 
            });
        }
    }

    public class StringLoggerFactory
    {
        private List<LogHolder> stringBuilder = new List<LogHolder>();

        public ILoggerFactory CreateStringLogger()
        {
            return LoggerFactory.Create(builder =>
            {
                builder.AddProvider(new StringLoggerProvider(stringBuilder));
                builder.AddConsole().SetMinimumLevel(LogLevel.Trace);
            });
        }

        public string ToString(LogLevel minLevel = LogLevel.Trace)
        {
            return stringBuilder.Where(x => (int)x.LogLevel >= (int)minLevel).Select(x => $"{x.LogLevel}: {x.Message}").Join("\n");
        }

    }

    public class LogHolder
    {
        public LogLevel LogLevel { get; set; }
        public string Message { get; set; }
    }