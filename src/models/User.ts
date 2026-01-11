import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/database";
import bcrypt from "bcryptjs";

interface UserAttributes {
  user_id: string; // UUID
  email: string;
  name: string;
  profile_image_url?: string | null;
  timezone?: string | null;
  kakao_id?: string | null;
  apple_id?: string | null;
  naver_id?: string | null;
  password?: string | null;
  phone?: string | null; // 전화번호 (E.164 형식 권장)
  created_at?: Date;
}

interface UserCreationAttributes
  extends Optional<
    UserAttributes,
    | "user_id"
    | "profile_image_url"
    | "timezone"
    | "kakao_id"
    | "apple_id"
    | "naver_id"
    | "password"
    | "phone"
    | "created_at"
  > {}

class User
  extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes
{
  declare user_id: string;
  declare email: string;
  declare name: string;
  declare profile_image_url: string | null | undefined;
  declare timezone: string | null | undefined;
  declare kakao_id: string | null | undefined;
  declare apple_id: string | null | undefined;
  declare naver_id: string | null | undefined;
  declare password: string | null | undefined;
  declare phone: string | null | undefined;
  declare created_at: Date | undefined;

  // 비밀번호 검증 메서드 (패스워드 인증 추가 시 사용)
  public async validatePassword(input_password: string): Promise<boolean> {
    if (!this.password) return false;
    return bcrypt.compare(input_password, this.password);
  }

  // JSON 변환 시 비밀번호 제외
  public toJSON(): Omit<UserAttributes, "password"> {
    const values = { ...this.get() };
    delete (values as Partial<UserAttributes>).password;
    return values as Omit<UserAttributes, "password">;
  }
}

User.init(
  {
    user_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    profile_image_url: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    timezone: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    kakao_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: true,
    },
    apple_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: true,
    },
    naver_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: true,
    },
    password: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    phone: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "users",
    modelName: "User",
    timestamps: false, // created_at만 사용, updated_at 없음
    hooks: {
      // 비밀번호 해싱 (패스워드 인증 추가 시 사용)
      beforeCreate: async (user: User) => {
        if (user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
      beforeUpdate: async (user: User) => {
        if (user.changed("password") && user.password) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      },
    },
  }
);

export default User;
