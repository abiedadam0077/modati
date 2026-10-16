// Minimal @minecraft/server-ui stub for tests: forms resolve as cancelled.
class Form {
  title(): this { return this; }
  body(): this { return this; }
  button(): this { return this; }
  toggle(): this { return this; }
  slider(): this { return this; }
  textField(): this { return this; }
  dropdown(): this { return this; }
  show(): Promise<{ canceled: boolean; selection?: number; formValues?: unknown[] }> {
    return Promise.resolve({ canceled: true });
  }
}
export class ActionFormData extends Form {}
export class ModalFormData extends Form {}
export class MessageFormData extends Form {}
