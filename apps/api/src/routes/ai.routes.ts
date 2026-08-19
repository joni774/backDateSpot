import { createAiRouter } from "@datespot/ai-logic";
import { env } from "../config/env";
import { verifyTokenMiddleware } from "../middleware/auth.middleware";

export default createAiRouter({
  verifyTokenMiddleware,
  openai: env.OPENAI_API_KEY
    ? {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        classifierModel: env.OPENAI_CLASSIFIER_MODEL,
      }
    : null,
  publicApiUrl: env.PUBLIC_API_URL,
});
