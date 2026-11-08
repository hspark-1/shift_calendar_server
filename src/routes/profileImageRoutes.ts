import { Router } from "express";
import { param } from "express-validator";
import { authMiddleware } from "../middlewares/auth";
import { validateRequestMiddleware } from "../middlewares/validateRequest";
import { getProfileImage } from "../controllers/profileImageController";

const router = Router();
router.get("/profile-images/:user_id", authMiddleware,
  param("user_id").isUUID(), validateRequestMiddleware, getProfileImage);
export default router;
