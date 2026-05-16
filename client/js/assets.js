/**
 * assets.js — Asset loader for Deep Sea Pulse: Catan Edition
 * Loads all game assets from the deep_sea_pulse_separate_png_only directory.
 */
const GameAssets = (function () {
  const BASE = '/deep_sea_pulse_separate_png_only';

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`Failed to load: ${src}`);
        resolve(img);
      };
      img.src = src;
    });
  }

  function loadImageSync(src) {
    const img = new Image();
    img.src = src;
    return img;
  }

  const assets = {
    // ═══ Resource Island Tiles ═══
    wood_island: loadImageSync(`${BASE}/tiles_resource_islands/wood_island.png`),
    stone_island: loadImageSync(`${BASE}/tiles_resource_islands/stone_island.png`),
    iron_island: loadImageSync(`${BASE}/tiles_resource_islands/iron_island.png`),
    gold_island: loadImageSync(`${BASE}/tiles_resource_islands/gold_island.png`),
    food_island: loadImageSync(`${BASE}/tiles_resource_islands/resource_island_generic.png`),
    desert_island: loadImageSync(`${BASE}/tiles_resource_islands/resource_island_generic.png`),

    // ═══ Sea Hex Tiles ═══
    sea: loadImageSync(`${BASE}/tiles_hex/hex_tile_01.png`),
    sea2: loadImageSync(`${BASE}/tiles_hex/hex_tile_02.png`),
    sea3: loadImageSync(`${BASE}/tiles_hex/hex_tile_03.png`),

    // ═══ Structures ═══
    village_blue: loadImageSync(`${BASE}/structures/village_blue.png`),
    village_neutral: loadImageSync(`${BASE}/structures/village_neutral.png`),
    city_blue: loadImageSync(`${BASE}/structures/city_upgrade_blue.png`),
    city_neutral: loadImageSync(`${BASE}/structures/city_upgrade_neutral.png`),
    dock_blue: loadImageSync(`${BASE}/structures/dock_long_blue.png`),
    dock_neutral: loadImageSync(`${BASE}/structures/dock_long_neutral.png`),
    lighthouse: loadImageSync(`${BASE}/structures/lighthouse_blue.png`),
    capital_harbor: loadImageSync(`${BASE}/structures/capital_harbor_blue.png`),

    // ═══ Ships ═══
    navy_blue: loadImageSync(`${BASE}/ships_navy/navy_warship_blue_normal.png`),
    navy_red: loadImageSync(`${BASE}/ships_navy/navy_warship_red_normal.png`),
    navy_green: loadImageSync(`${BASE}/ships_navy/navy_warship_green_normal.png`),
    navy_purple: loadImageSync(`${BASE}/ships_navy/navy_warship_purple_normal.png`),
    merchant_blue: loadImageSync(`${BASE}/ships_merchant/merchant_ship_blue_normal.png`),
    merchant_red: loadImageSync(`${BASE}/ships_merchant/merchant_ship_red_normal.png`),
    merchant_green: loadImageSync(`${BASE}/ships_merchant/merchant_ship_green_normal.png`),
    merchant_purple: loadImageSync(`${BASE}/ships_merchant/merchant_ship_purple_normal.png`),

    // ═══ Resource Icons (large) ═══
    icon_wood: loadImageSync(`${BASE}/icons_resources_actions/wood_icon_large.png`),
    icon_stone: loadImageSync(`${BASE}/icons_resources_actions/stone_icon_large.png`),
    icon_iron: loadImageSync(`${BASE}/icons_resources_actions/iron_icon_large.png`),
    icon_gold: loadImageSync(`${BASE}/icons_resources_actions/gold_icon_large.png`),
    icon_food: loadImageSync(`${BASE}/icons_resources_actions/food_counter.png`),

    // ═══ Resource Counters ═══
    counter_wood: loadImageSync(`${BASE}/icons_resources_actions/wood_counter.png`),
    counter_stone: loadImageSync(`${BASE}/icons_resources_actions/stone_counter.png`),
    counter_iron: loadImageSync(`${BASE}/icons_resources_actions/iron_counter.png`),
    counter_gold: loadImageSync(`${BASE}/icons_resources_actions/gold_counter.png`),
    counter_food: loadImageSync(`${BASE}/icons_resources_actions/food_counter.png`),

    // ═══ Action Icons ═══
    icon_build: loadImageSync(`${BASE}/icons_resources_actions/build_icon.png`),
    icon_trade: loadImageSync(`${BASE}/icons_resources_actions/trade_icon.png`),
    icon_move: loadImageSync(`${BASE}/icons_resources_actions/move_icon.png`),
    icon_loot: loadImageSync(`${BASE}/icons_resources_actions/loot_icon.png`),
    icon_destroy: loadImageSync(`${BASE}/icons_resources_actions/destroy_icon.png`),
    icon_confirm: loadImageSync(`${BASE}/icons_resources_actions/command_confirm_icon.png`),
    icon_connection: loadImageSync(`${BASE}/icons_resources_actions/connection_icon.png`),
    icon_warning: loadImageSync(`${BASE}/icons_resources_actions/warning_icon.png`),
    icon_vp: loadImageSync(`${BASE}/icons_resources_actions/victory_points_icon_large.png`),
    icon_pulse: loadImageSync(`${BASE}/icons_resources_actions/pulse_icon_large.png`),

    // ═══ UI Panels & Buttons ═══
    panel_build: loadImageSync(`${BASE}/ui_panels_buttons/build_shop_panel.png`),
    btn_build: loadImageSync(`${BASE}/ui_panels_buttons/button_build.png`),
    btn_cancel: loadImageSync(`${BASE}/ui_panels_buttons/button_cancel.png`),
    btn_confirm: loadImageSync(`${BASE}/ui_panels_buttons/button_confirm.png`),
    btn_upgrade: loadImageSync(`${BASE}/ui_panels_buttons/button_upgrade.png`),
    resource_bar: loadImageSync(`${BASE}/ui_panels_buttons/resource_status_bar.png`),
    timer_panel: loadImageSync(`${BASE}/ui_panels_buttons/next_pulse_timer.png`),

    // ═══ Disaster / Robber ═══
    robber: loadImageSync(`${BASE}/disasters_board_effects/disaster_icon_storm.png`),

    // ═══ FX / Flags (player colors) ═══
    flag_blue: loadImageSync(`${BASE}/fx_ui_overlays_flags/fx_asset_34.png`),
    flag_red: loadImageSync(`${BASE}/fx_ui_overlays_flags/fx_asset_35.png`),
    flag_green: loadImageSync(`${BASE}/fx_ui_overlays_flags/fx_asset_36.png`),
    flag_purple: loadImageSync(`${BASE}/fx_ui_overlays_flags/fx_asset_37.png`),
  };

  /**
   * Get the island tile image for a resource type.
   */
  assets.getIslandTile = function (resourceType) {
    switch (resourceType) {
      case 'wood': return assets.wood_island;
      case 'stone': return assets.stone_island;
      case 'iron': return assets.iron_island;
      case 'gold': return assets.gold_island;
      case 'food': return assets.food_island;
      default: return assets.desert_island;
    }
  };

  /**
   * Get the structure image for a player color.
   */
  assets.getVillage = function (playerIndex) {
    return assets.village_blue; // We'll tint in canvas
  };

  assets.getCity = function (playerIndex) {
    return assets.city_blue;
  };

  return assets;
})();
