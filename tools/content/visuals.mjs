// Visual entities: rotor (kinetic parts), item_display, block_display (contraptions), seat.
// Generates BP entity definitions, RP client entities, animations and render controllers.

export const ROTOR_ID = 'craftoria:rotor';

function prop(type, range, def) {
  return { type, range, default: def, client_sync: true };
}

const NO_DAMAGE = { triggers: [{ cause: 'all', deals_damage: 'no' }] };

function inanimateComponents(extra = {}) {
  return {
    'minecraft:type_family': { family: ['craftoria_visual', 'inanimate'] },
    'minecraft:collision_box': { width: 0.1, height: 0.1 },
    'minecraft:physics': { has_gravity: false, has_collision: false },
    'minecraft:pushable': { is_pushable: false, is_pushable_by_piston: false },
    'minecraft:damage_sensor': NO_DAMAGE,
    'minecraft:health': { value: 20, max: 20 },
    'minecraft:knockback_resistance': { value: 1 },
    'minecraft:fire_immune': {},
    'minecraft:breathable': { breathes_air: true, breathes_water: true, breathes_lava: true, breathes_solids: true, total_supply: 15, suffocate_time: 0 },
    'minecraft:persistent': {},
    'minecraft:nameable': { always_show: false, allow_name_tag_renaming: false },
    ...extra,
  };
}

export function rotorBehavior() {
  return {
    format_version: '1.21.90',
    'minecraft:entity': {
      description: {
        identifier: ROTOR_ID,
        is_spawnable: false,
        is_summonable: true,
        properties: {
          'craftoria:model': prop('int', [0, 63], 0),
          'craftoria:dir': prop('int', [0, 5], 1),
          'craftoria:roll': prop('int', [0, 270], 0),
          'craftoria:speed': prop('float', [-2048, 2048], 0),
          'craftoria:speed2': prop('float', [-2048, 2048], 0),
          'craftoria:phase': prop('float', [0, 360], 0),
          'craftoria:p1': prop('float', [-4096, 4096], 0),
          'craftoria:p2': prop('float', [-4096, 4096], 0),
          'craftoria:p3': prop('float', [-4096, 4096], 0),
          'craftoria:p4': prop('float', [-4096, 4096], 0),
          'craftoria:rate': prop('float', [0, 100], 1),
        },
      },
      components: inanimateComponents(),
    },
  };
}

/**
 * Rotor client entity. models: [{index, name}] (geometry identifiers geometry.craftoria.rotor_<name>)
 */
export function rotorClient(models) {
  const geometry = {}, textures = {};
  for (const m of models) {
    geometry[`m${m.index}`] = `geometry.craftoria.rotor_${m.name}`;
    textures[`m${m.index}`] = `textures/entity/craftoria/rotor_${m.name}`;
  }
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: ROTOR_ID,
        materials: { default: 'entity_alphatest' },
        textures,
        geometry,
        animations: {
          base: 'animation.craftoria.rotor.base',
          mixer: 'animation.craftoria.rotor.mixer',
          deployer: 'animation.craftoria.rotor.deployer',
          arm: 'animation.craftoria.rotor.arm',
          rope: 'animation.craftoria.rotor.rope',
          gauge: 'animation.craftoria.rotor.gauge',
        },
        scripts: {
          initialize: ['v.mix = 0.0;', 'v.dep = 0.0;', 'v.ay = 0.0;', 'v.al = 0.0;', 'v.au = 0.0;', 'v.ah = 0.0;', 'v.g = 0.0;', 'v.rope = 0.0;'],
          pre_animation: [
            't.dir = q.property(\'craftoria:dir\');',
            'v.ox = t.dir == 0 ? 180 : (t.dir == 2 ? -90 : (t.dir == 3 ? 90 : 0));',
            'v.oz = t.dir == 4 ? -90 : (t.dir == 5 ? 90 : 0);',
            'v.t = (math.mod(q.time_stamp, 72000) + q.frame_alpha) / 20;',
            'v.a1 = math.mod(q.property(\'craftoria:phase\') + v.t * q.property(\'craftoria:speed\') * 6, 360);',
            'v.a2 = math.mod(q.property(\'craftoria:phase\') + v.t * q.property(\'craftoria:speed2\') * 6, 360);',
            't.k = math.min(1, q.delta_time * 6);',
          ],
          animate: [
            'base',
            { mixer: "q.property('craftoria:model') == 9" },
            { deployer: "q.property('craftoria:model') == 14" },
            { arm: "q.property('craftoria:model') == 15" },
            { rope: "q.property('craftoria:model') == 19" },
            { gauge: "q.property('craftoria:model') == 20" },
          ],
        },
        render_controllers: ['controller.render.craftoria.rotor'],
        enable_attachables: false,
        hide_armor: true,
      },
    },
  };
}

export function rotorRenderController(models) {
  const maxIndex = Math.max(...models.map((m) => m.index));
  const geos = [], texs = [];
  for (let i = 0; i <= maxIndex; i++) {
    const m = models.find((x) => x.index === i) ?? models[0];
    geos.push(`Geometry.m${m.index}`);
    texs.push(`Texture.m${m.index}`);
  }
  return {
    format_version: '1.10.0',
    render_controllers: {
      'controller.render.craftoria.rotor': {
        arrays: { geometries: { 'Array.geos': geos }, textures: { 'Array.texs': texs } },
        geometry: "Array.geos[q.property('craftoria:model')]",
        materials: [{ '*': 'Material.default' }],
        textures: ["Array.texs[q.property('craftoria:model')]"],
      },
    },
  };
}

export function rotorAnimations() {
  const k = (a, b) => `${a} = ${a} + (${b} - ${a}) * t.k;`;
  return {
    format_version: '1.8.0',
    animations: {
      'animation.craftoria.rotor.base': {
        loop: true,
        bones: {
          yaw: { rotation: [0, '-q.body_y_rotation', 0] },
          orient: { rotation: ['v.ox', 0, 'v.oz'] },
          roll: { rotation: [0, "-q.property('craftoria:roll')", 0] },
          spin: { rotation: [0, '-v.a1', 0] },
          spin_b: { rotation: [0, '-v.a1', 0] },
          spin_r: { rotation: [0, 'v.a1', 0] },
          spin_rb: { rotation: [0, 'v.a1', 0] },
          spin2: { rotation: [0, '-v.a2', 0] },
          spinx: { rotation: ['v.a1', 0, 0] },
        },
      },
      // press head cycle, triggered from script with Entity.playAnimation (rate = cycles per second)
      'animation.craftoria.rotor.press_cycle': {
        loop: false,
        animation_length: 1.0,
        anim_time_update: "q.anim_time + q.delta_time * q.property('craftoria:rate')",
        bones: {
          press_head: { position: [0, "-q.property('craftoria:p1') * 16 * (q.anim_time < 0.5 ? math.pow(q.anim_time * 2, 3) : math.max(0, 1 - (q.anim_time - 0.5) * 2.2))", 0] },
        },
      },
      'animation.craftoria.rotor.mixer': {
        loop: true,
        bones: {
          mixer_head: { position: [0, `${k('v.mix', "q.property('craftoria:p1')")} return -v.mix * 22;`, 0] },
          mixer_spin: { rotation: [0, "-math.mod(v.t * q.property('craftoria:p2') * 6, 360)", 0] },
        },
      },
      'animation.craftoria.rotor.deployer': {
        loop: true,
        bones: {
          hand: { position: [0, `${k('v.dep', "q.property('craftoria:p1')")} return v.dep * 12;`, 0] },
        },
      },
      'animation.craftoria.rotor.arm': {
        loop: true,
        bones: {
          arm_base: { rotation: [0, `${k('v.ay', "q.property('craftoria:p1')")} return -v.ay;`, 0] },
          arm_lower: { rotation: [`${k('v.al', "q.property('craftoria:p2')")} return v.al;`, 0, 0] },
          arm_upper: { rotation: [`${k('v.au', "q.property('craftoria:p3')")} return v.au;`, 0, 0] },
          arm_head: { rotation: [`${k('v.ah', "q.property('craftoria:p4')")} return v.ah;`, 0, 0] },
        },
      },
      'animation.craftoria.rotor.rope': {
        loop: true,
        bones: {
          rope: { scale: [1, `${k('v.rope', "q.property('craftoria:p1')")} return math.max(0.001, v.rope);`, 1] },
          rope_magnet: { position: [0, '-v.rope * 16', 0] },
        },
      },
      'animation.craftoria.rotor.gauge': {
        loop: true,
        bones: {
          needle_n: { rotation: [0, `${k('v.g', "q.property('craftoria:p1')")} return v.g;`, 0] },
          needle_s: { rotation: [0, 'v.g', 0] },
          needle_e: { rotation: [0, 'v.g', 0] },
          needle_w: { rotation: [0, 'v.g', 0] },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Item display: renders any item held in its main hand (via rightItem bone).
export const ITEM_DISPLAY_ID = 'craftoria:item_display';

export function itemDisplayBehavior() {
  return {
    format_version: '1.21.90',
    'minecraft:entity': {
      description: {
        identifier: ITEM_DISPLAY_ID,
        is_spawnable: false,
        is_summonable: true,
        properties: {
          'craftoria:scale': prop('float', [0, 4], 1),
          'craftoria:mode': prop('int', [0, 3], 0),
        },
      },
      components: inanimateComponents({ 'minecraft:equipment': {} }),
    },
  };
}

export function itemDisplayClient() {
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: ITEM_DISPLAY_ID,
        materials: { default: 'entity_alphatest' },
        textures: { default: 'textures/entity/craftoria/item_display' },
        geometry: { default: 'geometry.craftoria.item_display' },
        animations: { pose: 'animation.craftoria.item_display.pose' },
        scripts: { animate: ['pose'] },
        render_controllers: ['controller.render.craftoria.item_display'],
        enable_attachables: true,
        hide_armor: true,
      },
    },
  };
}

export function itemDisplayGeometry() {
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: 'geometry.craftoria.item_display', texture_width: 16, texture_height: 16, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0, 0.5, 0] },
        bones: [
          { name: 'root', pivot: [0, 0, 0] },
          { name: 'body', parent: 'root', pivot: [0, 4, 0] },
          { name: 'rightArm', parent: 'body', pivot: [0, 4, 0] },
          { name: 'rightItem', parent: 'rightArm', pivot: [0, 4, 0] },
        ],
      },
    ],
  };
}

export function itemDisplayAnimations() {
  return {
    format_version: '1.8.0',
    animations: {
      'animation.craftoria.item_display.pose': {
        loop: true,
        bones: {
          root: {
            rotation: [0, "-q.body_y_rotation + (q.property('craftoria:mode') == 1 ? math.mod(q.life_time * 90, 360) : 0)", 0],
            scale: "q.property('craftoria:scale')",
          },
          rightArm: { rotation: ["q.property('craftoria:mode') == 2 ? -90 : 0", 0, 0] },
        },
      },
    },
  };
}

export function itemDisplayRenderController() {
  return {
    format_version: '1.10.0',
    render_controllers: {
      'controller.render.craftoria.item_display': {
        geometry: 'Geometry.default',
        materials: [{ '*': 'Material.default' }],
        textures: ['Texture.default'],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Block display: moving contraption blocks. Geometry index chooses a shape, texture indices pick
// vanilla textures by path (referenced, not copied) or CRAFTORIA block atlases.
export const BLOCK_DISPLAY_ID = 'craftoria:block_display';

export function blockDisplayBehavior() {
  return {
    format_version: '1.21.90',
    'minecraft:entity': {
      description: {
        identifier: BLOCK_DISPLAY_ID,
        is_spawnable: false,
        is_summonable: true,
        properties: {
          'craftoria:geo': prop('int', [0, 127], 0),
          'craftoria:tex': prop('int', [0, 255], 0),
          'craftoria:tex2': prop('int', [0, 255], 0),
          'craftoria:dir': prop('int', [0, 5], 1),
          'craftoria:bdir': prop('int', [0, 5], 1),
          'craftoria:speed': prop('float', [-2048, 2048], 0),
          'craftoria:phase': prop('float', [-100000, 100000], 0),
          'craftoria:ox': prop('float', [-1024, 1024], 0),
          'craftoria:oy': prop('float', [-1024, 1024], 0),
          'craftoria:oz': prop('float', [-1024, 1024], 0),
        },
      },
      components: inanimateComponents({ 'minecraft:equipment': {} }),
    },
  };
}

/**
 * vanillaTex: [{index, side, top}] ; customGeos: [{index, name}] (geometry.craftoria.bd_<name>, texture path)
 */
export function blockDisplayClient(texList, customGeos) {
  const textures = { none: 'textures/entity/craftoria/item_display' };
  for (const t of texList) textures[`t${t.index}`] = t.path;
  const geometry = { cube_side: 'geometry.craftoria.bd_cube_side', cube_cap: 'geometry.craftoria.bd_cube_cap', holder: 'geometry.craftoria.item_display' };
  for (const g of customGeos) geometry[`g${g.index}`] = `geometry.craftoria.bd_${g.name}`;
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: BLOCK_DISPLAY_ID,
        materials: { default: 'entity_alphatest' },
        textures,
        geometry,
        animations: { pose: 'animation.craftoria.block_display.pose' },
        scripts: {
          pre_animation: [
            't.d = q.property(\'craftoria:dir\');',
            'v.ox = t.d == 0 ? 180 : (t.d == 2 ? -90 : (t.d == 3 ? 90 : 0));',
            'v.oz = t.d == 4 ? -90 : (t.d == 5 ? 90 : 0);',
            't.b = q.property(\'craftoria:bdir\');',
            'v.bx = t.b == 0 ? 180 : (t.b == 2 ? -90 : (t.b == 3 ? 90 : 0));',
            'v.bz = t.b == 4 ? -90 : (t.b == 5 ? 90 : 0);',
            // re-anchor client extrapolation whenever the server sends a new phase (angle)
            't.now = q.time_stamp + q.frame_alpha;',
            't.ph = q.property(\'craftoria:phase\');',
            'v.tb = (v.lp != t.ph) ? t.now : v.tb;',
            'v.lp = t.ph;',
            'v.ang = math.mod(t.ph + (t.now - v.tb) / 20 * q.property(\'craftoria:speed\') * 6, 360);',
          ],
          initialize: ['v.lp = -99999.0;', 'v.tb = 0.0;'],
          animate: ['pose'],
        },
        render_controllers: [
          { 'controller.render.craftoria.bd_side': "q.property('craftoria:geo') == 0" },
          { 'controller.render.craftoria.bd_cap': "q.property('craftoria:geo') == 0" },
          { 'controller.render.craftoria.bd_custom': "q.property('craftoria:geo') > 1" },
          { 'controller.render.craftoria.bd_holder': "q.property('craftoria:geo') == 1" },
        ],
        enable_attachables: true,
        hide_armor: true,
      },
    },
  };
}

export function blockDisplayRenderControllers(texList, customGeos) {
  const maxT = Math.max(0, ...texList.map((t) => t.index));
  const texArr = [];
  for (let i = 0; i <= maxT; i++) texArr.push(texList.find((t) => t.index === i) ? `Texture.t${i}` : 'Texture.none');
  const maxG = Math.max(2, ...customGeos.map((g) => g.index));
  const geoArr = [], gtexArr = [];
  for (let i = 0; i <= maxG; i++) {
    const g = customGeos.find((x) => x.index === i);
    geoArr.push(g ? `Geometry.g${i}` : 'Geometry.cube_side');
    gtexArr.push(g ? `Texture.t${g.texIndex}` : 'Texture.none');
  }
  return {
    format_version: '1.10.0',
    render_controllers: {
      'controller.render.craftoria.bd_side': {
        arrays: { textures: { 'Array.t': texArr } },
        geometry: 'Geometry.cube_side',
        materials: [{ '*': 'Material.default' }],
        textures: ["Array.t[q.property('craftoria:tex')]"],
      },
      'controller.render.craftoria.bd_cap': {
        arrays: { textures: { 'Array.t': texArr } },
        geometry: 'Geometry.cube_cap',
        materials: [{ '*': 'Material.default' }],
        textures: ["Array.t[q.property('craftoria:tex2')]"],
      },
      'controller.render.craftoria.bd_custom': {
        arrays: { geometries: { 'Array.g': geoArr }, textures: { 'Array.gt': gtexArr } },
        geometry: "Array.g[q.property('craftoria:geo')]",
        materials: [{ '*': 'Material.default' }],
        textures: ["Array.gt[q.property('craftoria:geo')]"],
      },
      'controller.render.craftoria.bd_holder': {
        geometry: 'Geometry.holder',
        materials: [{ '*': 'Material.default' }],
        textures: ['Texture.none'],
      },
    },
  };
}

export function blockDisplayCubeGeometries() {
  const cube = (id, faces) => ({
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: id, texture_width: 16, texture_height: 16, visible_bounds_width: 3, visible_bounds_height: 3, visible_bounds_offset: [0, 0.5, 0] },
        bones: [
          { name: 'root', pivot: [0, 0, 0] },
          { name: 'block', parent: 'root', pivot: [0, 8, 0], cubes: [{ origin: [-8, 0, -8], size: [16, 16, 16], uv: Object.fromEntries(faces.map((f) => [f, f === 'up' || f === 'down' ? { uv: [16, 16], uv_size: [-16, -16] } : { uv: [0, 0], uv_size: [16, 16] }])) }] },
        ],
      },
    ],
  });
  return {
    side: cube('geometry.craftoria.bd_cube_side', ['north', 'south', 'east', 'west']),
    cap: cube('geometry.craftoria.bd_cube_cap', ['up', 'down']),
  };
}

// ---------------------------------------------------------------------------
// Seat entity (players sit on seats / contraptions / train controls)
export const SEAT_ID = 'craftoria:seat_entity';
export function seatBehavior() {
  return {
    format_version: '1.21.90',
    'minecraft:entity': {
      description: { identifier: SEAT_ID, is_spawnable: false, is_summonable: true },
      components: inanimateComponents({
        'minecraft:rideable': {
          seat_count: 1,
          family_types: ['player'],
          interact_text: 'action.interact.ride.craftoria_seat',
          pull_in_entities: false,
          crouching_skip_interact: true,
          seats: [{ position: [0, 0.1, 0], lock_rider_rotation: 0 }],
        },
        'minecraft:collision_box': { width: 0.6, height: 0.3 },
      }),
    },
  };
}
export function seatClient() {
  return {
    format_version: '1.10.0',
    'minecraft:client_entity': {
      description: {
        identifier: SEAT_ID,
        materials: { default: 'entity_alphatest' },
        textures: { default: 'textures/entity/craftoria/item_display' },
        geometry: { default: 'geometry.craftoria.item_display' },
        render_controllers: ['controller.render.craftoria.item_display'],
        hide_armor: true,
      },
    },
  };
}
