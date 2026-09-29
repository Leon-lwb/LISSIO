import { shortToolName } from './chatMarkdown';

export type ActivityKind = 'read' | 'edit' | 'command' | 'search' | 'web' | 'tool';

/** Map tool names to the activity vocabulary used in the chat timeline. */
export function toolActivityKind(name: string): ActivityKind {
  const action = shortToolName(name).toLowerCase();
  if (/(^|_)(web|browser)(_|$)/.test(name.toLowerCase()) || /(^|_)(url|fetch|scrape|navigate|page)(_|$)/.test(action)) return 'web';
  if (/(^|_)(search|find|lookup|query)(_|$)/.test(action)) return 'search';
  if (/(^|_)(run|exec|shell|terminal|command|send|inject|flush|compute|export|start|stop|restart)(_|$)/.test(action)) return 'command';
  if (/(^|_)(add|create|update|remove|delete|move|set|apply|connect|disconnect|open|close|write|release|switch)(_|$)/.test(action)) return 'edit';
  if (/(^|_)(get|list|read|inspect|describe|load)(_|$)/.test(action)) return 'read';
  return 'tool';
}
