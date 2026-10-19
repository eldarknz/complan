export class CommandHistory {
  constructor(limit = 10) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  record(before, after) {
    if (JSON.stringify(before.project) === JSON.stringify(after.project)) return false;
    this.past.push(structuredClone({ before, after }));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return true;
  }

  undo() {
    const command = this.past.pop();
    if (!command) return null;
    this.future.push(command);
    return structuredClone(command.before);
  }

  redo() {
    const command = this.future.pop();
    if (!command) return null;
    this.past.push(command);
    return structuredClone(command.after);
  }
}
