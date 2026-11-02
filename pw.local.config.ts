import base from "./playwright.config";
export default { ...base, use: { ...base.use, launchOptions: { executablePath: process.env.PW_CHROME } } };
