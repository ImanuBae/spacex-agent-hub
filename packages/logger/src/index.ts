type Fields = Record<string, unknown>;
type Sink = (line: string) => void;

export function createLogger(service: string, sink: Sink = console.log) {
  function write(level: string, message: string, fields: Fields = {}) {
    sink(JSON.stringify({ ...fields, timestamp: new Date().toISOString(), service, level, message }));
  }
  return {
    info: (message: string, fields?: Fields) => write("info", message, fields),
    error: (message: string, fields?: Fields) => write("error", message, fields),
  };
}
