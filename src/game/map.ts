import type {MapBox} from './types';
export const MAP_SIZE={width:44,depth:40};
export const MAP_BOXES:MapBox[]=[
 {x:-22,z:0,w:1,d:41,h:5,kind:'wall'},{x:22,z:0,w:1,d:41,h:5,kind:'wall'},
 {x:0,z:-20,w:45,d:1,h:5,kind:'wall'},{x:0,z:20,w:45,d:1,h:5,kind:'wall'},
 {x:-9,z:0,w:9,d:13,h:5.3,kind:'wall'},{x:10,z:0,w:8,d:12,h:4.5,kind:'wall'},
 {x:0,z:5,w:3.8,d:2.6,h:2.2,kind:'crate'},{x:1,z:-7,w:3.8,d:2.6,h:2.2,kind:'crate'},
 {x:-17,z:9,w:3,d:4.5,h:2.1,kind:'crate'},{x:17,z:-9,w:3,d:4.5,h:2.1,kind:'crate'},
 {x:-8,z:13,w:6,d:2.7,h:2.5,kind:'container'},{x:8,z:-13,w:6,d:2.7,h:2.5,kind:'container'},
 {x:15,z:12,w:2.2,d:2.2,h:1.15,kind:'crate'},{x:-15,z:-12,w:2.2,d:2.2,h:1.15,kind:'crate'},
];
export const BLUE_SPAWNS=[{x:0,z:16},{x:-8,z:17},{x:8,z:17}];
export const RED_SPAWNS=[{x:0,z:-16},{x:4,z:-17},{x:-5,z:-17}];
