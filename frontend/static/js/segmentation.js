/**
 * CERES Adaptive Pond Segmentation
 * Divides an arbitrary pond polygon into equal-area segments.
 */

'use strict';

const MAX_SEGMENT_AREA_M2 = 2500;

window.CeresSegmentation = {
    
    /**
     * Convert Leaflet LatLng array to Turf.js Polygon feature
     * Leaflet uses [Lat, Lng], Turf uses [Lng, Lat]
     */
    leafletToTurfPolygon: function(latlngs) {
        if (!latlngs || latlngs.length < 3) return null;
        
        let coords = latlngs.map(p => {
            if (Array.isArray(p)) return [p[1], p[0]]; // [lat, lng] array
            return [p.lng, p.lat]; // L.LatLng object
        });
        
        // Ensure polygon is closed
        if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
            coords.push([...coords[0]]);
        }
        
        return turf.polygon([coords]);
    },

    /**
     * Convert Turf.js Feature geometry (Polygon/MultiPolygon) back to Leaflet format
     * Returns an array of rings (for Polygon) or array of polygons (for MultiPolygon)
     */
    turfToLeafletCoords: function(feature) {
        if (!feature || !feature.geometry) return [];
        
        const geomType = feature.geometry.type;
        const coords = feature.geometry.coordinates;
        
        const swapCoords = (ring) => ring.map(pt => [pt[1], pt[0]]);
        
        if (geomType === 'Polygon') {
            return swapCoords(coords[0]); // Return outer ring
        } else if (geomType === 'MultiPolygon') {
            // Flatten outer rings of all polygons into a single array for rendering/pathing
            // For simple rendering, Leaflet accepts array of arrays for polygons with holes,
            // or array of array of arrays for multipolygons.
            return coords.map(poly => swapCoords(poly[0]));
        }
        return [];
    },

    /**
     * Generate adaptive segments for a given pond boundary
     * @param {Array} latlngs - Leaflet boundary array
     * @returns {Object} { area_m2, segments: Array of segment objects }
     */
    generateSegments: function(latlngs) {
        const pondFeature = this.leafletToTurfPolygon(latlngs);
        if (!pondFeature) return { area_m2: 0, segments: [] };

        const totalArea = turf.area(pondFeature); // in square meters
        if (totalArea === 0) return { area_m2: 0, segments: [] };

        let numSegments = Math.ceil(totalArea / MAX_SEGMENT_AREA_M2);
        // Fallback to 1 if something goes wrong
        if (numSegments < 1) numSegments = 1;

        let generatedSegments = [];
        let remainingFeature = pondFeature;

        // Sweep-line binary search to divide into equal areas
        for (let i = 0; i < numSegments - 1; i++) {
            const targetArea = turf.area(remainingFeature) / (numSegments - i);
            const bbox = turf.bbox(remainingFeature);
            const minX = bbox[0], minY = bbox[1], maxX = bbox[2], maxY = bbox[3];
            
            let low = minX;
            let high = maxX;
            let bestIntersection = null;
            let bestRight = null;

            // 50 iterations is more than enough for precise floating point convergence
            for (let step = 0; step < 50; step++) {
                let mid = (low + high) / 2;
                
                // Left bounding box
                let leftBbox = turf.bboxPolygon([minX, minY, mid, maxY]);
                let rightBbox = turf.bboxPolygon([mid, minY, maxX, maxY]);
                
                let leftIntersection = turf.intersect(turf.featureCollection([remainingFeature, leftBbox]));
                
                if (!leftIntersection) {
                    low = mid;
                    continue;
                }
                
                let currentArea = turf.area(leftIntersection);
                
                // If we are within 1 square meter or very close, break
                if (Math.abs(currentArea - targetArea) < 1.0) {
                    bestIntersection = leftIntersection;
                    bestRight = turf.intersect(turf.featureCollection([remainingFeature, rightBbox]));
                    break;
                }
                
                if (currentArea < targetArea) {
                    low = mid;
                    bestIntersection = leftIntersection;
                    bestRight = turf.intersect(turf.featureCollection([remainingFeature, rightBbox]));
                } else {
                    high = mid;
                }
            }

            if (bestIntersection && bestRight) {
                generatedSegments.push(bestIntersection);
                remainingFeature = bestRight;
            } else {
                break; // Fallback if binary search fails geometrically
            }
        }
        
        // Add the last remaining piece
        if (remainingFeature && turf.area(remainingFeature) > 0.1) {
            generatedSegments.push(remainingFeature);
        }

        // Process generated segments into final data structure
        const finalSegments = generatedSegments.map((feat, index) => {
            const segArea = turf.area(feat);
            // turf.pointOnFeature guarantees the point is inside the polygon (approx pole of inaccessibility)
            const pt = turf.pointOnFeature(feat);
            const centroid = { lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0] };
            
            return {
                segment_id: index + 1,
                polygon: this.turfToLeafletCoords(feat),
                area_m2: parseFloat(segArea.toFixed(2)),
                centroid: centroid,
                visited: false,
                measurements: []
            };
        });

        return {
            area_m2: parseFloat(totalArea.toFixed(2)),
            segments: finalSegments
        };
    }
};
