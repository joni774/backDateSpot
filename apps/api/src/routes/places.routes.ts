import { createPlacesRouter } from "@datespot/places-logic";
import { optionalAuth, verifyTokenMiddleware } from "../middleware/auth.middleware";

export default createPlacesRouter({ optionalAuth, verifyTokenMiddleware });
