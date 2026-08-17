-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: May 05, 2026 at 09:02 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `tryon_app`
--

-- --------------------------------------------------------

--
-- Table structure for table `analytics_daily`
--

CREATE TABLE `analytics_daily` (
  `id` int(10) UNSIGNED NOT NULL,
  `merchant_id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) DEFAULT NULL,
  `shopify_store_id` varchar(100) DEFAULT NULL,
  `date` date NOT NULL,
  `tryon_initiated` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `tryon_completed` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `tryon_failed` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `add_to_cart_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `buy_now_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `save_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `share_wa_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `order_count` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `revenue_inr` decimal(12,2) NOT NULL DEFAULT 0.00,
  `avg_latency_ms` int(10) UNSIGNED DEFAULT NULL,
  `computed_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `analytics_daily`
--

INSERT INTO `analytics_daily` (`id`, `merchant_id`, `shopify_domain`, `shopify_store_id`, `date`, `tryon_initiated`, `tryon_completed`, `tryon_failed`, `add_to_cart_count`, `buy_now_count`, `save_count`, `share_wa_count`, `order_count`, `revenue_inr`, `avg_latency_ms`, `computed_at`) VALUES
(1, 1, NULL, NULL, '2026-03-28', 0, 5, 0, 0, 0, 0, 0, 0, 0.00, NULL, '2026-03-28 15:44:45'),
(6, 2, NULL, NULL, '2026-03-30', 0, 7, 3, 0, 0, 0, 0, 0, 0.00, NULL, '2026-03-30 13:27:37');

-- --------------------------------------------------------

--
-- Table structure for table `merchants`
--

CREATE TABLE `merchants` (
  `id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) NOT NULL,
  `shopify_store_id` varchar(100) NOT NULL,
  `access_token` text NOT NULL,
  `plan` enum('free','starter','growth','scale') NOT NULL DEFAULT 'free',
  `api_key` varchar(64) NOT NULL,
  `api_secret` varchar(64) NOT NULL,
  `tryon_count_month` int(10) UNSIGNED NOT NULL DEFAULT 0,
  `billing_cycle_start` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `shopify_plan` varchar(100) DEFAULT NULL,
  `installed_theme_name` varchar(255) DEFAULT NULL,
  `installed_theme_id` bigint(20) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `merchants`
--

INSERT INTO `merchants` (`id`, `shopify_domain`, `shopify_store_id`, `access_token`, `plan`, `api_key`, `api_secret`, `tryon_count_month`, `billing_cycle_start`, `is_active`, `created_at`, `updated_at`, `shopify_plan`, `installed_theme_name`, `installed_theme_id`) VALUES
(1, 'fitfyce.myshopify.com', 'fitfyce.myshopify.com', 'shpua_a38053eff11531a0564390048ded0751', 'free', 'tf_7aeb105fce0de57beafb9b27a895499eca87af75bebefbe4', '2a1fd90dcba1291df3df19f44a1e2b26ad081ecc9d4723524b035d889841b062', 2, '2026-03-28', 1, '2026-03-28 13:17:32', '2026-03-28 14:43:55', NULL, NULL, NULL),
(2, 'pushnova3.myshopify.com', 'pushnova3.myshopify.com', 'shpua_ae7a45d3219245fe70a3ad8e751f611c', 'free', 'tf_430359939a16aeee2d0c598cfdf57fe3ffa513bb495e4555', '312401eafc4b26a32cef8d500a9f2b48df5d7b73a9d28403677cd2553628e9b3', 0, '2026-03-30', 1, '2026-03-30 12:51:56', '2026-03-30 12:51:56', NULL, NULL, NULL),
(3, 'combo-reinstall.myshopify.com', 'combo-reinstall.myshopify.com', 'shpua_f33082752699ea1b49da2f844e2ec15f', 'free', 'tf_31289db76953a78eb4f68b9ab5c5a82c18817b6148f11c2a', '2e6acf970e9c8a4424646c909648db21d63088d970548a0b0d0833e1dc35e7be', 0, '2026-04-25', 1, '2026-04-25 09:04:58', '2026-04-25 09:04:58', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `merchant_settings`
--

CREATE TABLE `merchant_settings` (
  `id` int(10) UNSIGNED NOT NULL,
  `merchant_id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) DEFAULT NULL,
  `shopify_store_id` varchar(100) DEFAULT NULL,
  `widget_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`widget_config`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `plan_limits`
--

CREATE TABLE `plan_limits` (
  `plan` enum('free','starter','growth','scale') NOT NULL,
  `monthly_tryon_limit` int(10) UNSIGNED NOT NULL,
  `max_products` int(10) UNSIGNED NOT NULL,
  `analytics_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `custom_api_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `branding_removable` tinyint(1) NOT NULL DEFAULT 0,
  `share_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `price_inr_monthly` int(10) UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `plan_limits`
--

INSERT INTO `plan_limits` (`plan`, `monthly_tryon_limit`, `max_products`, `analytics_enabled`, `custom_api_enabled`, `branding_removable`, `share_enabled`, `price_inr_monthly`) VALUES
('free', 50, 1, 0, 0, 0, 1, 0),
('starter', 500, 0, 0, 0, 1, 1, 999),
('growth', 3000, 0, 1, 0, 1, 1, 2499),
('scale', 0, 0, 1, 1, 1, 1, 5999);

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` int(10) UNSIGNED NOT NULL,
  `merchant_id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) DEFAULT NULL,
  `shopify_store_id` varchar(100) DEFAULT NULL,
  `shopify_product_id` bigint(20) UNSIGNED NOT NULL,
  `shopify_product_gid` varchar(100) NOT NULL,
  `title` varchar(500) NOT NULL,
  `handle` varchar(500) NOT NULL,
  `is_tryon_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `collection_id` bigint(20) UNSIGNED DEFAULT NULL,
  `collection_title` varchar(255) DEFAULT NULL,
  `collection_handle` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`id`, `merchant_id`, `shopify_domain`, `shopify_store_id`, `shopify_product_id`, `shopify_product_gid`, `title`, `handle`, `is_tryon_enabled`, `created_at`, `updated_at`, `collection_id`, `collection_title`, `collection_handle`) VALUES
(10, 1, NULL, NULL, 9448793571571, 'gid://shopify/Product/9448793571571', 'Saree', 'saree', 1, '2026-03-28 13:17:33', '2026-03-28 15:45:37', NULL, NULL, NULL),
(22, 1, NULL, NULL, 9448793243891, 'gid://shopify/Product/9448793243891', 'Salwar', 'salwar', 1, '2026-03-28 14:00:10', '2026-03-28 15:30:19', NULL, NULL, NULL),
(51, 2, NULL, NULL, 10396482109733, 'gid://shopify/Product/10396482109733', 'kurti', 't-shir', 1, '2026-03-30 12:52:04', '2026-03-30 13:14:19', NULL, NULL, NULL),
(53, 2, NULL, NULL, 10396488925477, 'gid://shopify/Product/10396488925477', 'saree', 'saree', 1, '2026-03-30 12:54:19', '2026-03-30 13:08:19', NULL, NULL, NULL),
(61, 3, NULL, NULL, 9471102648568, 'gid://shopify/Product/9471102648568', 'FMCG Daily Essentials 09', 'fmcg-daily-essentials-09-f9', 1, '2026-04-28 12:36:06', '2026-04-29 05:31:30', NULL, NULL, NULL),
(62, 3, NULL, NULL, 9471101796600, 'gid://shopify/Product/9471101796600', 'Clothing Collection 03', 'clothing-collection-03-c3', 0, '2026-04-28 12:56:40', '2026-04-29 04:58:25', NULL, NULL, NULL),
(65, 3, NULL, NULL, 9471102320888, 'gid://shopify/Product/9471102320888', 'Clothing Collection 18', 'clothing-collection-18-c18', 1, '2026-04-29 05:09:16', '2026-04-29 05:21:29', NULL, NULL, NULL),
(68, 3, NULL, NULL, 9471102222584, 'gid://shopify/Product/9471102222584', 'Clothing Collection 15', 'clothing-collection-15-c15', 1, '2026-04-29 05:21:24', '2026-04-29 05:21:29', NULL, NULL, NULL),
(69, 3, NULL, NULL, 9471102189816, 'gid://shopify/Product/9471102189816', 'Clothing Collection 14', 'clothing-collection-14-c14', 1, '2026-04-29 05:21:24', '2026-04-29 05:21:29', NULL, NULL, NULL),
(70, 3, NULL, NULL, 9471102255352, 'gid://shopify/Product/9471102255352', 'Clothing Collection 16', 'clothing-collection-16-c16', 1, '2026-04-29 05:21:24', '2026-04-29 05:21:29', NULL, NULL, NULL),
(71, 3, NULL, NULL, 9471102288120, 'gid://shopify/Product/9471102288120', 'Clothing Collection 17', 'clothing-collection-17-c17', 1, '2026-04-29 05:21:24', '2026-04-29 05:21:29', NULL, NULL, NULL),
(72, 3, NULL, NULL, 9471102124280, 'gid://shopify/Product/9471102124280', 'Clothing Collection 12', 'clothing-collection-12-c12', 1, '2026-04-29 05:21:24', '2026-04-29 05:21:29', NULL, NULL, NULL),
(73, 3, NULL, NULL, 9471102157048, 'gid://shopify/Product/9471102157048', 'Clothing Collection 13', 'clothing-collection-13-c13', 1, '2026-04-29 05:21:24', '2026-04-29 05:21:29', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `tryon_conversions`
--

CREATE TABLE `tryon_conversions` (
  `id` int(10) UNSIGNED NOT NULL,
  `tryon_session_id` char(36) NOT NULL,
  `merchant_id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) DEFAULT NULL,
  `shopify_store_id` varchar(100) DEFAULT NULL,
  `shopify_order_id` bigint(20) UNSIGNED NOT NULL,
  `shopify_order_gid` varchar(100) DEFAULT NULL,
  `order_value_inr` decimal(10,2) DEFAULT NULL,
  `attributed_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `tryon_sessions`
--

CREATE TABLE `tryon_sessions` (
  `id` char(36) NOT NULL,
  `merchant_id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) DEFAULT NULL,
  `shopify_store_id` varchar(100) DEFAULT NULL,
  `product_id` int(10) UNSIGNED NOT NULL,
  `variant_id` int(10) UNSIGNED DEFAULT NULL,
  `status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  `result_image_url` text DEFAULT NULL,
  `result_seed` int(11) DEFAULT NULL,
  `result_expires_at` datetime DEFAULT NULL,
  `error_message` varchar(500) DEFAULT NULL,
  `api_request_at` datetime DEFAULT NULL,
  `api_response_at` datetime DEFAULT NULL,
  `api_latency_ms` int(10) UNSIGNED DEFAULT NULL,
  `action_add_to_cart` tinyint(1) NOT NULL DEFAULT 0,
  `action_buy_now` tinyint(1) NOT NULL DEFAULT 0,
  `action_save_image` tinyint(1) NOT NULL DEFAULT 0,
  `action_share_wa` tinyint(1) NOT NULL DEFAULT 0,
  `device_type` enum('mobile','tablet','desktop') DEFAULT NULL,
  `country_code` char(2) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `variant_image_mappings`
--

CREATE TABLE `variant_image_mappings` (
  `id` int(10) UNSIGNED NOT NULL,
  `product_id` int(10) UNSIGNED NOT NULL,
  `shopify_variant_id` bigint(20) UNSIGNED NOT NULL,
  `shopify_variant_gid` varchar(100) NOT NULL,
  `variant_title` varchar(255) DEFAULT NULL,
  `tryon_image_url` text NOT NULL,
  `image_type` enum('flat_lay','ghost_mannequin','on_model') NOT NULL DEFAULT 'flat_lay',
  `avatar_sex` enum('male','female') DEFAULT NULL,
  `clothing_prompt` varchar(500) DEFAULT NULL,
  `is_approved` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `merchant_id` int(10) UNSIGNED NOT NULL,
  `shopify_domain` varchar(255) DEFAULT NULL,
  `shopify_store_id` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `variant_image_mappings`
--

INSERT INTO `variant_image_mappings` (`id`, `product_id`, `shopify_variant_id`, `shopify_variant_gid`, `variant_title`, `tryon_image_url`, `image_type`, `avatar_sex`, `clothing_prompt`, `is_approved`, `created_at`, `updated_at`, `merchant_id`, `shopify_domain`, `shopify_store_id`) VALUES
(1, 10, 48768788398323, 'gid://shopify/ProductVariant/48768788398323', 'Default Title', 'https://fitfyce.myshopify.com/cdn/shop/files/5_42_aad16775-89eb-468b-abed-45be36684ceb.webp?v=1774703262&width=1100', 'flat_lay', NULL, 'Drape as the saree', 1, '2026-03-28 13:21:57', '2026-05-05 12:27:25', 1, NULL, NULL),
(4, 22, 48768787251443, 'gid://shopify/ProductVariant/48768787251443', 'Default Title', 'https://cdn.shopify.com/s/files/1/0821/0864/5619/files/Black_shorts_2.jpg?v=1774687813&width=823', 'on_model', NULL, NULL, 1, '2026-03-28 14:05:59', '2026-05-05 12:27:25', 1, NULL, NULL),
(13, 53, 52167719649573, 'gid://shopify/ProductVariant/52167719649573', 'Default Title', 'https://cdn.shopify.com/s/files/1/0972/4015/4405/files/5_42_aad16775-89eb-468b-abed-45be36684ceb.png?v=1774876013', 'flat_lay', 'female', 'Drape the saree to the women indian style its a flat layer', 1, '2026-03-30 12:54:52', '2026-05-05 12:27:25', 2, NULL, NULL);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `analytics_daily`
--
ALTER TABLE `analytics_daily`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_merchant_date` (`merchant_id`,`date`),
  ADD KEY `idx_date` (`date`);

--
-- Indexes for table `merchants`
--
ALTER TABLE `merchants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `shopify_domain` (`shopify_domain`),
  ADD UNIQUE KEY `shopify_store_id` (`shopify_store_id`),
  ADD UNIQUE KEY `api_key` (`api_key`),
  ADD KEY `idx_api_key` (`api_key`),
  ADD KEY `idx_domain` (`shopify_domain`);

--
-- Indexes for table `merchant_settings`
--
ALTER TABLE `merchant_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_merchant_settings` (`merchant_id`);

--
-- Indexes for table `plan_limits`
--
ALTER TABLE `plan_limits`
  ADD PRIMARY KEY (`plan`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_merchant_product` (`merchant_id`,`shopify_product_id`),
  ADD KEY `idx_enabled` (`merchant_id`,`is_tryon_enabled`),
  ADD KEY `idx_collection` (`collection_id`);

--
-- Indexes for table `tryon_conversions`
--
ALTER TABLE `tryon_conversions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_order_session` (`shopify_order_id`,`tryon_session_id`),
  ADD KEY `fk_tc_session` (`tryon_session_id`),
  ADD KEY `fk_tc_merchant` (`merchant_id`);

--
-- Indexes for table `tryon_sessions`
--
ALTER TABLE `tryon_sessions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_ts_product` (`product_id`),
  ADD KEY `idx_merchant_date` (`merchant_id`,`created_at`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `variant_image_mappings`
--
ALTER TABLE `variant_image_mappings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_variant` (`product_id`,`shopify_variant_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `analytics_daily`
--
ALTER TABLE `analytics_daily`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `merchants`
--
ALTER TABLE `merchants`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `merchant_settings`
--
ALTER TABLE `merchant_settings`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=83;

--
-- AUTO_INCREMENT for table `tryon_conversions`
--
ALTER TABLE `tryon_conversions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `variant_image_mappings`
--
ALTER TABLE `variant_image_mappings`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=17;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `analytics_daily`
--
ALTER TABLE `analytics_daily`
  ADD CONSTRAINT `fk_ad_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `merchants` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `merchant_settings`
--
ALTER TABLE `merchant_settings`
  ADD CONSTRAINT `fk_ms_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `merchants` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `fk_p_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `merchants` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `tryon_conversions`
--
ALTER TABLE `tryon_conversions`
  ADD CONSTRAINT `fk_tc_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `merchants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tc_session` FOREIGN KEY (`tryon_session_id`) REFERENCES `tryon_sessions` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `tryon_sessions`
--
ALTER TABLE `tryon_sessions`
  ADD CONSTRAINT `fk_ts_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `merchants` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ts_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `variant_image_mappings`
--
ALTER TABLE `variant_image_mappings`
  ADD CONSTRAINT `fk_vim_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
