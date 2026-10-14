import {
  PrismaClient,
  Gender,
  Role,
  ComplaintStatus,
  PaymentStatus,
  OrderStatus,
  ProductStatus,
  ReviewStatus,
} from "../generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Enums are re-exported so handlers can compare against a real value rather than a string
// literal. A typo'd literal is a type error against the generated enum but a silent always-false
// comparison against `any`, which is how an authorisation check ends up passing everything.
export {
  prisma,
  Gender,
  Role,
  ComplaintStatus,
  PaymentStatus,
  OrderStatus,
  ProductStatus,
  ReviewStatus,
};
