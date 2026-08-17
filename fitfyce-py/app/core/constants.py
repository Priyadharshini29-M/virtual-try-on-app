"""Port of the constants in fitfyce-php/config/AppConfig.php."""

WIDGET_DEFAULTS: dict = {
    "button_text": "Try On This Look",
    "widget_subtitle": "See how it fits before you buy",
    "button_color": "#111827",
    "button_text_color": "#FFFFFF",
    "button_border_radius": 8,
    "hover_bg_color": "#F3F4F6",
    "button_width": 0,
    "button_height": 0,
    "button_padding_top": 10,
    "button_padding_right": 24,
    "button_padding_bottom": 10,
    "button_padding_left": 24,
    "button_margin_top": 0,
    "button_margin_right": 0,
    "button_margin_bottom": 0,
    "button_margin_left": 0,
    "title_font_size": 20,
    "subtitle_font_size": 14,
    "title_font_weight": "600",
    "title_font_family": "Inter, sans-serif",
    "subtitle_font_family": "Inter, sans-serif",
    "button_position": "below_images",
    "widget_language": "en",
    "button_icon": "eye",
    "icon_color": "#FFFFFF",
    "main_icon_bg_color": "transparent",
    "coll_icon_bg_color": "transparent",
    "icon_size": 16,
    "icon_radius": 4,
    "icon_shape": "square",
    "icon_opacity": 100,
    "show_on_collection": 1,
    "collection_position": "top_right",
    "show_watermark": 1,
    "share_whatsapp_enabled": 1,
    "save_image_enabled": 1,
    "privacy_notice_shown": 1,
}

BUTTON_POSITIONS = ["below_images", "below_atc", "floating"]
BUTTON_ICONS = ["none", "eye", "sparkles", "camera", "shopping-bag"]
ICON_SHAPES = ["square", "circle"]
COLLECTION_POSITIONS = ["top_left", "top_right", "bottom_left", "bottom_right"]

SESSION_ACTIONS = ["add_to_cart", "buy_now", "save_image", "share_wa"]
ACTION_ANALYTICS_MAP = {
    "add_to_cart": "add_to_cart_count",
    "buy_now": "buy_now_count",
    "save_image": "save_count",
    "share_wa": "share_wa_count",
}

CONVERSION_ATTRIBUTION_DAYS = 7
UPLOAD_MAX_BYTES = 5 * 1024 * 1024
JPEG_QUALITY = 90

API_KEY_PREFIX = "tf_"
DEFAULT_PLAN = "basic"
SHOPIFY_APP_URL = "https://apps.shopify.com/tryfit"
