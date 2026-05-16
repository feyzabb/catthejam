const GameAssets = (function() {
  function loadImage(src) {
    const img = new Image();
    img.src = src;
    return img;
  }

  return {
    // Sea tiles (we can use one for the base sea)
    sea: loadImage('assets/tiles_hex__hex_tile_01.png'),

    // Resource Islands
    wood: loadImage('assets/tiles_resource_islands__wood_island.png'),
    stone: loadImage('assets/tiles_resource_islands__stone_island.png'),
    iron: loadImage('assets/tiles_resource_islands__iron_island.png'),
    gold: loadImage('assets/tiles_resource_islands__gold_island.png'),

    // Capital / Structures
    capital: loadImage('assets/tiles_resource_islands__capital_harbor_tile_01.png'),
    village: loadImage('assets/structures__village_neutral.png'),
    city: loadImage('assets/structures__city_upgrade_neutral.png'),

    // Ships
    navy: loadImage('assets/ships_navy__navy_warship_blue_normal.png'),
    merchant: loadImage('assets/ships_merchant__merchant_ship_blue_normal.png'),

    // HUD Resource Icons
    icon_wood: loadImage('assets/icons_resources_actions__wood_icon_large.png'),
    icon_stone: loadImage('assets/icons_resources_actions__stone_icon_large.png'),
    icon_iron: loadImage('assets/icons_resources_actions__iron_icon_large.png'),
    icon_gold: loadImage('assets/icons_resources_actions__gold_icon_large.png'),

    // HUD Action Icons
    icon_build_navy: loadImage('assets/icons_resources_actions__build_icon.png'),
    icon_place_merchant: loadImage('assets/icons_resources_actions__connection_icon.png'),
    icon_build_village: loadImage('assets/icons_resources_actions__build_icon.png'),
    icon_upgrade_city: loadImage('assets/structures__city_upgrade_neutral.png')
  };
})();
