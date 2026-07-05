import { createPlacesRouter } from "@datespot/places-logic";
import { env } from "../config/env";
import { optionalAuth, verifyTokenMiddleware } from "../middleware/auth.middleware";

export default createPlacesRouter({
  optionalAuth,
  verifyTokenMiddleware,
  googlePlacesApiKey: env.GOOGLE_PLACES_API_KEY ?? env.GOOGLE_MAPS_API_KEY,
  publicApiUrl: env.PUBLIC_API_URL,
});
