export class HttpFailure extends Error {
  readonly status: number;

  constructor(status: number) {
    super("request_failed");
    this.name = "HttpFailure";
    this.status = status;
  }
}
