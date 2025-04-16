export interface LogLine {
    [key: string]: any;
  
    event: string;
    error?: Error;
  }
  