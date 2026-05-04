-- Expand merchant_settings to match the widget configuration UI
-- Run after 007_shop_meta.sql

-- Allow any IETF language tag (not just en/ta/hi)
ALTER TABLE merchant_settings
    MODIFY COLUMN widget_language VARCHAR(10) NOT NULL DEFAULT 'en';

-- Add all new configuration columns
ALTER TABLE merchant_settings
    ADD COLUMN widget_subtitle       VARCHAR(200)   NULL                        AFTER button_text,
    ADD COLUMN button_border_radius  INT UNSIGNED   NOT NULL DEFAULT 8           AFTER button_text_color,
    ADD COLUMN hover_bg_color        VARCHAR(7)     NOT NULL DEFAULT '#F3F4F6'   AFTER button_border_radius,
    ADD COLUMN button_width          INT UNSIGNED   NOT NULL DEFAULT 0           AFTER hover_bg_color,
    ADD COLUMN button_height         INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_width,
    ADD COLUMN button_padding_top    INT UNSIGNED   NOT NULL DEFAULT 10          AFTER button_height,
    ADD COLUMN button_padding_right  INT UNSIGNED   NOT NULL DEFAULT 24          AFTER button_padding_top,
    ADD COLUMN button_padding_bottom INT UNSIGNED   NOT NULL DEFAULT 10          AFTER button_padding_right,
    ADD COLUMN button_padding_left   INT UNSIGNED   NOT NULL DEFAULT 24          AFTER button_padding_bottom,
    ADD COLUMN button_margin_top     INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_padding_left,
    ADD COLUMN button_margin_right   INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_margin_top,
    ADD COLUMN button_margin_bottom  INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_margin_right,
    ADD COLUMN button_margin_left    INT UNSIGNED   NOT NULL DEFAULT 0           AFTER button_margin_bottom,
    ADD COLUMN title_font_size       INT UNSIGNED   NOT NULL DEFAULT 20          AFTER button_margin_left,
    ADD COLUMN subtitle_font_size    INT UNSIGNED   NOT NULL DEFAULT 14          AFTER title_font_size,
    ADD COLUMN title_font_weight     VARCHAR(10)    NOT NULL DEFAULT '600'       AFTER subtitle_font_size,
    ADD COLUMN title_font_family     VARCHAR(100)   NOT NULL DEFAULT 'Inter, sans-serif' AFTER title_font_weight,
    ADD COLUMN subtitle_font_family  VARCHAR(100)   NOT NULL DEFAULT 'Inter, sans-serif' AFTER title_font_family,
    ADD COLUMN button_icon           VARCHAR(30)    NOT NULL DEFAULT 'eye'       AFTER subtitle_font_family,
    ADD COLUMN icon_color            VARCHAR(7)     NOT NULL DEFAULT '#FFFFFF'   AFTER button_icon,
    ADD COLUMN main_icon_bg_color    VARCHAR(20)    NOT NULL DEFAULT 'transparent' AFTER icon_color,
    ADD COLUMN coll_icon_bg_color    VARCHAR(20)    NOT NULL DEFAULT 'transparent' AFTER main_icon_bg_color,
    ADD COLUMN icon_size             INT UNSIGNED   NOT NULL DEFAULT 16          AFTER coll_icon_bg_color,
    ADD COLUMN icon_radius           INT UNSIGNED   NOT NULL DEFAULT 4           AFTER icon_size,
    ADD COLUMN icon_shape            VARCHAR(20)    NOT NULL DEFAULT 'square'    AFTER icon_radius,
    ADD COLUMN icon_opacity          INT UNSIGNED   NOT NULL DEFAULT 100         AFTER icon_shape,
    ADD COLUMN show_on_collection    TINYINT(1)     NOT NULL DEFAULT 1           AFTER icon_opacity,
    ADD COLUMN collection_position   ENUM('top_left','top_right','bottom_left','bottom_right')
                                                    NOT NULL DEFAULT 'top_right' AFTER show_on_collection,
    ADD COLUMN created_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
