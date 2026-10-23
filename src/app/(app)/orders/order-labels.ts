export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "PACKED" | "SHIPPED" | "COMPLETED" | "CANCELLED";
export type Channel = "WEBSITE" | "WHATSAPP" | "INSTAGRAM" | "SHOPEE" | "TOKOPEDIA" | "TIKTOK" | "LAZADA" | "OTHER";

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: "yellow" | "blue" | "purple" | "lime" | "gray" | "neutral" }> = {
  PENDING_PAYMENT: { label: "Menunggu bayar", color: "yellow" },
  PAID: { label: "Dibayar", color: "blue" },
  PACKED: { label: "Dikemas", color: "purple" },
  SHIPPED: { label: "Dikirim", color: "lime" },
  COMPLETED: { label: "Selesai", color: "gray" },
  CANCELLED: { label: "Dibatalkan", color: "neutral" },
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  WEBSITE: "Website",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  SHOPEE: "Shopee",
  TOKOPEDIA: "Tokopedia",
  TIKTOK: "TikTok Shop",
  LAZADA: "Lazada",
  OTHER: "Lainnya",
};
