/**
 * assets.js — Asset loader for Deep Sea Pulse: Catan Edition
 * Loads all high-res assets from the local client/assets/deep_sea_pulse_png_assets directory.
 */
const GameAssets = (function () {
  const BASE = '/assets/deep_sea_pulse_png_assets';
  const UI_BASE = '/assets';

  function loadImageSync(src) {
    const img = new Image();
    img.src = src;
    return img;
  }

  const assets = {
    // ═══ High-Res Beautiful Ocean Background ═══
    deniz: loadImageSync(`${BASE}/Deniz.png`),

    // ═══ Resource Island Tiles ═══
    wood_island: loadImageSync(`${BASE}/wood_island.png`),
    stone_island: loadImageSync(`${BASE}/rocky_island.png`),
    iron_island: loadImageSync(`${BASE}/iron_island.png`),
    gold_island: loadImageSync(`${BASE}/gold_crystal_island.png`),
    food_island: loadImageSync(`${BASE}/food_island.png`),
    desert_island: loadImageSync(`${BASE}/rocky_island.png`),

    // ═══ Robber Overlay (shown on top of a tile when robber is placed there) ═══
    storm_overlay: loadImageSync(`${BASE}/storm_tile.png`),

    // ═══ Structures (Pre-existing UI/Board) ═══
    village_blue: loadImageSync(`${UI_BASE}/structures__village_blue.png`),
    village_neutral: loadImageSync(`${UI_BASE}/structures__village_neutral.png`),
    city_blue: loadImageSync(`${UI_BASE}/structures__city_upgrade_blue.png`),
    city_neutral: loadImageSync(`${UI_BASE}/structures__city_upgrade_neutral.png`),
    dock_blue: loadImageSync(`${UI_BASE}/structures__dock_long_blue.png`),
    dock_neutral: loadImageSync(`${UI_BASE}/structures__dock_long_neutral.png`),
    lighthouse: loadImageSync(`${UI_BASE}/structures__lighthouse_blue.png`),
    capital_harbor: loadImageSync(`${UI_BASE}/structures__capital_harbor_blue.png`),

    // ═══ Ships ═══
    navy_blue: loadImageSync(`${UI_BASE}/ships_navy__navy_warship_blue_normal.png`),
    navy_red: loadImageSync(`${UI_BASE}/ships_navy__navy_warship_red_normal.png`),
    navy_green: loadImageSync(`${UI_BASE}/ships_navy__navy_warship_green_normal.png`),
    navy_purple: loadImageSync(`${UI_BASE}/ships_navy__navy_warship_purple_normal.png`),
    merchant_blue: loadImageSync(`${UI_BASE}/ships_merchant__merchant_ship_blue_normal.png`),
    merchant_red: loadImageSync(`${UI_BASE}/ships_merchant__merchant_ship_red_normal.png`),
    merchant_green: loadImageSync(`${UI_BASE}/ships_merchant__merchant_ship_green_normal.png`),
    merchant_purple: loadImageSync(`${UI_BASE}/ships_merchant__merchant_ship_purple_normal.png`),

    // ═══ Resource Icons (large) ═══
    icon_wood: loadImageSync(`${UI_BASE}/icons_resources_actions__wood_icon_large.png`),
    icon_stone: loadImageSync(`${UI_BASE}/icons_resources_actions__stone_icon_large.png`),
    icon_iron: loadImageSync(`${UI_BASE}/icons_resources_actions__iron_icon_large.png`),
    icon_gold: loadImageSync(`${UI_BASE}/icons_resources_actions__gold_icon_large.png`),
    icon_food: loadImageSync(`${UI_BASE}/icons_resources_actions__food_counter.png`),

    // ═══ Resource Counters ═══
    counter_wood: loadImageSync(`${UI_BASE}/icons_resources_actions__wood_counter.png`),
    counter_stone: loadImageSync(`${UI_BASE}/icons_resources_actions__stone_counter.png`),
    counter_iron: loadImageSync(`${UI_BASE}/icons_resources_actions__iron_counter.png`),
    counter_gold: loadImageSync(`${UI_BASE}/icons_resources_actions__gold_counter.png`),
    counter_food: loadImageSync(`${UI_BASE}/icons_resources_actions__food_counter.png`),

    // ═══ Action Icons ═══
    icon_build: loadImageSync(`${UI_BASE}/icons_resources_actions__build_icon.png`),
    icon_trade: loadImageSync(`${UI_BASE}/icons_resources_actions__trade_icon.png`),
    icon_move: loadImageSync(`${UI_BASE}/icons_resources_actions__move_icon.png`),
    icon_loot: loadImageSync(`${UI_BASE}/icons_resources_actions__loot_icon.png`),
    icon_destroy: loadImageSync(`${UI_BASE}/icons_resources_actions__destroy_icon.png`),
    icon_confirm: loadImageSync(`${UI_BASE}/icons_resources_actions__command_confirm_icon.png`),
    icon_connection: loadImageSync(`${UI_BASE}/icons_resources_actions__connection_icon.png`),
    icon_warning: loadImageSync(`${UI_BASE}/icons_resources_actions__warning_icon.png`),
    icon_vp: loadImageSync(`${UI_BASE}/icons_resources_actions__victory_points_icon_large.png`),
    icon_pulse: loadImageSync(`${UI_BASE}/icons_resources_actions__pulse_icon_large.png`),

    // ═══ UI Panels & Buttons ═══
    panel_build: loadImageSync(`${UI_BASE}/ui_panels_buttons__build_shop_panel.png`),
    btn_build: loadImageSync(`${UI_BASE}/ui_panels_buttons__button_build.png`),
    btn_cancel: loadImageSync(`${UI_BASE}/ui_panels_buttons__button_cancel.png`),
    btn_confirm: loadImageSync(`${UI_BASE}/ui_panels_buttons__button_confirm.png`),
    btn_upgrade: loadImageSync(`${UI_BASE}/ui_panels_buttons__button_upgrade.png`),
    resource_bar: loadImageSync(`${UI_BASE}/ui_panels_buttons__resource_status_bar.png`),
    timer_panel: loadImageSync(`${UI_BASE}/ui_panels_buttons__next_pulse_timer.png`),

    // ═══ Disaster / Robber ═══
    robber: loadImageSync(`${UI_BASE}/disasters_board_effects__disaster_icon_storm.png`),
    storm_board_effect: loadImageSync(`${UI_BASE}/disasters_board_effects__board_effect_storm.png`),

    // ═══ FX / Flags (player colors) ═══
    flag_blue: loadImageSync(`${UI_BASE}/fx_ui_overlays_flags__fx_asset_34.png`),
    flag_red: loadImageSync(`${UI_BASE}/fx_ui_overlays_flags__fx_asset_35.png`),
    flag_green: loadImageSync(`${UI_BASE}/fx_ui_overlays_flags__fx_asset_36.png`),
    flag_purple: loadImageSync(`${UI_BASE}/fx_ui_overlays_flags__fx_asset_37.png`),
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
    return assets.village_blue;
  };

  assets.getCity = function (playerIndex) {
    return assets.city_blue;
  };

  return assets;
})();
