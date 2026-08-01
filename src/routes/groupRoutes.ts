import { Router } from "express";
import { body, param, query } from "express-validator";
import * as groupController from "../controllers/groupController";
import { authMiddleware } from "../middlewares/auth";

const router = Router();
const group_id_validator = param("group_id").isUUID();
const invitation_id_validator = param("invitation_id").isUUID();
const member_user_id_validator = param("user_id").isUUID();
const pagination_validators = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];
const invitation_status_validator = query("status")
  .optional()
  .isIn(["PENDING", "ACCEPTED", "REJECTED", "CANCELED", "EXPIRED"]);
const invitee_validators = [
  body("invitee_user_ids").isArray({ min: 1, max: 100 }),
  body("invitee_user_ids.*").isUUID(),
  body("message").optional({ nullable: true }).isString().isLength({ max: 200 }),
];

router.use(authMiddleware);

router.post(
  "/groups",
  [
    body("name").isString(),
    body("timezone").optional().isString(),
    body("invitee_user_ids").optional().isArray({ max: 100 }),
    body("invitee_user_ids.*").optional().isUUID(),
  ],
  groupController.createGroup,
);
router.get("/groups", pagination_validators, groupController.getGroups);
router.get(
  "/groups/:group_id/calendar/range",
  [
    group_id_validator,
    query("start_date").matches(/^\d{4}-\d{2}-\d{2}$/),
    query("end_date").matches(/^\d{4}-\d{2}-\d{2}$/),
  ],
  groupController.getGroupCalendarRange,
);
router.post(
  "/groups/:group_id/invitations",
  [group_id_validator, ...invitee_validators],
  groupController.createInvitations,
);
router.get(
  "/group-invitations/received",
  [invitation_status_validator, ...pagination_validators],
  groupController.getReceivedInvitations,
);
router.put(
  "/group-invitations/:invitation_id/respond",
  [
    invitation_id_validator,
    body("action").isIn(["accept", "reject"]),
  ],
  groupController.respondToInvitation,
);

router.patch(
  "/groups/:group_id",
  [
    group_id_validator,
    body().custom((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        (value.name === undefined && value.timezone === undefined)
      ) {
        throw new Error("name 또는 timezone이 필요합니다.");
      }
      return true;
    }),
    body("name").optional({ nullable: false }).isString(),
    body("timezone").optional({ nullable: false }).isString(),
  ],
  groupController.updateGroup,
);
router.delete(
  "/groups/:group_id",
  [group_id_validator],
  groupController.deleteGroup,
);
router.get(
  "/groups/:group_id/invitations",
  [
    group_id_validator,
    invitation_status_validator,
    ...pagination_validators,
  ],
  groupController.getGroupInvitations,
);
router.put(
  "/group-invitations/:invitation_id/cancel",
  [invitation_id_validator],
  groupController.cancelInvitation,
);
router.delete(
  "/groups/:group_id/members/:user_id",
  [group_id_validator, member_user_id_validator],
  groupController.removeGroupMember,
);
router.patch(
  "/groups/:group_id/members/:user_id",
  [
    group_id_validator,
    member_user_id_validator,
    body("role").isIn(["ADMIN", "MEMBER"]),
  ],
  groupController.updateGroupMemberRole,
);
router.post(
  "/groups/:group_id/leave",
  [group_id_validator],
  groupController.leaveGroup,
);
router.put(
  "/groups/:group_id/owner",
  [group_id_validator, body("new_owner_user_id").isUUID()],
  groupController.transferGroupOwner,
);
router.get(
  "/groups/:group_id",
  [group_id_validator],
  groupController.getGroupDetail,
);

export default router;
