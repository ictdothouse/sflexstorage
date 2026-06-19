const sharp = require('sharp');

let exifReader;
try {
    exifReader = require('exif-reader');
} catch (e) {
    // exif-reader might export differently
    exifReader = null;
}

class ExifExtractor {
    /**
     * Extract EXIF metadata from an image file
     * Returns structured metadata object
     */
    async extract(imagePath) {
        try {
            const metadata = await sharp(imagePath).metadata();
            const result = {
                camera_make: '',
                camera_model: '',
                lens: '',
                focal_length: '',
                aperture: '',
                shutter_speed: '',
                iso: '',
                white_balance: '',
                flash: '',
                color_space: metadata.space || '',
                orientation: metadata.orientation || 1,
                gps_latitude: null,
                gps_longitude: null,
                gps_altitude: null,
                date_taken: '',
                software: '',
                copyright: '',
                all_exif: {}
            };

            // Parse EXIF buffer if available
            if (metadata.exif) {
                try {
                    let exifData;
                    if (exifReader) {
                        // exif-reader v2.x
                        if (typeof exifReader === 'function') {
                            exifData = exifReader(metadata.exif);
                        } else if (exifReader.default) {
                            exifData = exifReader.default(metadata.exif);
                        } else {
                            exifData = exifReader(metadata.exif);
                        }
                    }

                    if (exifData) {
                        // Image / IFD0 data
                        const ifd0 = exifData.Image || exifData.image || exifData[0] || {};
                        const exif = exifData.Photo || exifData.exif || exifData.Exif || {};
                        const gps = exifData.GPSInfo || exifData.gps || exifData.GPS || {};

                        result.camera_make = this.getString(ifd0.Make || ifd0.make);
                        result.camera_model = this.getString(ifd0.Model || ifd0.model);
                        result.software = this.getString(ifd0.Software || ifd0.software);
                        result.copyright = this.getString(ifd0.Copyright || ifd0.copyright);
                        result.orientation = ifd0.Orientation || ifd0.orientation || metadata.orientation || 1;

                        // EXIF data
                        result.lens = this.getString(exif.LensModel || exif.lensModel || exif.LensMake || '');
                        result.focal_length = this.formatFocalLength(exif.FocalLength || exif.focalLength);
                        result.aperture = this.formatAperture(exif.FNumber || exif.fNumber || exif.ApertureValue || exif.apertureValue);
                        result.shutter_speed = this.formatShutterSpeed(exif.ExposureTime || exif.exposureTime);
                        result.iso = this.getString(exif.ISOSpeedRatings || exif.ISO || exif.iso || exif.PhotographicSensitivity || '');
                        result.white_balance = this.formatWhiteBalance(exif.WhiteBalance || exif.whiteBalance);
                        result.flash = this.formatFlash(exif.Flash || exif.flash);
                        result.color_space = this.formatColorSpace(exif.ColorSpace || exif.colorSpace) || metadata.space || '';

                        // Date
                        const dateStr = exif.DateTimeOriginal || exif.dateTimeOriginal || exif.DateTimeDigitized || ifd0.DateTime;
                        if (dateStr) {
                            result.date_taken = dateStr instanceof Date ? dateStr.toISOString() : String(dateStr);
                        }

                        // GPS
                        if (gps) {
                            result.gps_latitude = this.parseGPSCoord(gps.GPSLatitude || gps.latitude, gps.GPSLatitudeRef || gps.latitudeRef);
                            result.gps_longitude = this.parseGPSCoord(gps.GPSLongitude || gps.longitude, gps.GPSLongitudeRef || gps.longitudeRef);
                            result.gps_altitude = gps.GPSAltitude || gps.altitude || null;
                            if (result.gps_altitude && typeof result.gps_altitude === 'object') {
                                result.gps_altitude = result.gps_altitude.valueOf ? result.gps_altitude.valueOf() : null;
                            }
                        }

                        // Store all EXIF as JSON
                        result.all_exif = this.sanitizeForJSON(exifData);
                    }
                } catch (exifError) {
                    console.warn('EXIF parsing warning:', exifError.message);
                    result.all_exif = { raw_error: exifError.message };
                }
            }

            // Add basic metadata from Sharp
            result.all_exif.sharp = {
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                space: metadata.space,
                channels: metadata.channels,
                density: metadata.density,
                hasAlpha: metadata.hasAlpha,
                isProgressive: metadata.isProgressive
            };

            return result;
        } catch (error) {
            console.error('EXIF extraction error:', error.message);
            return this.getEmptyMetadata();
        }
    }

    getString(val) {
        if (!val) return '';
        if (typeof val === 'string') return val.trim();
        if (Buffer.isBuffer(val)) return val.toString('utf-8').trim().replace(/\0/g, '');
        return String(val).trim();
    }

    formatFocalLength(val) {
        if (!val) return '';
        if (typeof val === 'number') return `${val}mm`;
        if (val.valueOf) return `${val.valueOf()}mm`;
        return String(val);
    }

    formatAperture(val) {
        if (!val) return '';
        if (typeof val === 'number') return `f/${val}`;
        if (val.valueOf) return `f/${val.valueOf()}`;
        return String(val);
    }

    formatShutterSpeed(val) {
        if (!val) return '';
        let num = typeof val === 'number' ? val : (val.valueOf ? val.valueOf() : parseFloat(val));
        if (isNaN(num)) return String(val);
        if (num >= 1) return `${num}s`;
        return `1/${Math.round(1 / num)}s`;
    }

    formatWhiteBalance(val) {
        if (val === undefined || val === null) return '';
        const wbMap = { 0: 'Auto', 1: 'Manual', 2: 'Auto', 3: 'One-touch', 4: 'One-touch', 5: 'Auto' };
        return wbMap[val] || String(val);
    }

    formatFlash(val) {
        if (val === undefined || val === null) return '';
        if (typeof val === 'object' && val.fired !== undefined) {
            return val.fired ? 'Fired' : 'Not fired';
        }
        const flashMap = {
            0: 'No Flash', 1: 'Fired', 5: 'Fired (no return)', 7: 'Fired (return)',
            8: 'On (not fired)', 9: 'On (fired)', 16: 'Off', 24: 'Auto (not fired)',
            25: 'Auto (fired)', 32: 'No flash function'
        };
        return flashMap[val] || (val ? 'Yes' : 'No');
    }

    formatColorSpace(val) {
        if (!val) return '';
        const csMap = { 1: 'sRGB', 2: 'Adobe RGB', 65535: 'Uncalibrated' };
        return csMap[val] || String(val);
    }

    parseGPSCoord(coord, ref) {
        if (!coord) return null;
        try {
            let degrees, minutes, seconds;
            if (Array.isArray(coord)) {
                degrees = typeof coord[0] === 'number' ? coord[0] : coord[0].valueOf();
                minutes = typeof coord[1] === 'number' ? coord[1] : coord[1].valueOf();
                seconds = typeof coord[2] === 'number' ? coord[2] : (coord[2] ? coord[2].valueOf() : 0);
            } else if (typeof coord === 'number') {
                return coord;
            } else {
                return null;
            }
            let decimal = degrees + (minutes / 60) + (seconds / 3600);
            if (ref === 'S' || ref === 'W') decimal = -decimal;
            return Math.round(decimal * 1000000) / 1000000;
        } catch (e) {
            return null;
        }
    }

    sanitizeForJSON(obj, depth = 0) {
        if (depth > 5) return '[max depth]';
        if (obj === null || obj === undefined) return null;
        if (Buffer.isBuffer(obj)) return '[Buffer]';
        if (obj instanceof Date) return obj.toISOString();
        if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
        if (typeof obj === 'string') return obj.replace(/\0/g, '');
        if (Array.isArray(obj)) return obj.map(item => this.sanitizeForJSON(item, depth + 1));
        if (typeof obj === 'object') {
            const clean = {};
            for (const [key, val] of Object.entries(obj)) {
                try {
                    clean[key] = this.sanitizeForJSON(val, depth + 1);
                } catch (e) {
                    clean[key] = '[error]';
                }
            }
            return clean;
        }
        return String(obj);
    }

    getEmptyMetadata() {
        return {
            camera_make: '', camera_model: '', lens: '', focal_length: '',
            aperture: '', shutter_speed: '', iso: '', white_balance: '',
            flash: '', color_space: '', orientation: 1,
            gps_latitude: null, gps_longitude: null, gps_altitude: null,
            date_taken: '', software: '', copyright: '', all_exif: {}
        };
    }
}

module.exports = ExifExtractor;
