import { Router, type IRouter } from "express";
import healthRouter from "./health";
import academicRouter from "./academic";
import authRouter from "./auth";
import meRouter from "./me";
import mlRouter from "./ml";
import { attachUser } from "../lib/auth-middleware";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attachUser);
router.use(authRouter);
router.use(meRouter);
router.use(academicRouter);
router.use(mlRouter);

export default router;
