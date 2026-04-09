import { Router, type IRouter } from "express";
import healthRouter from "./health";
import patternMatcherRouter from "./pattern-matcher";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/pattern-matcher", patternMatcherRouter);

export default router;
