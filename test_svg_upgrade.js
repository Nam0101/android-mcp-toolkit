const { registerSvgTool } = require('./src/tools/svgTool');

const mockServer = {
  registerTool: async (name, schema, handler) => {
    if (name === 'convert-svg-to-android-drawable') {
        console.log(`\n--- Testing SVG Tool with SVGO Latest ---`);
        const simpleSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"/></svg>';
        
        try {
            const res = await handler({ svg: simpleSvg });
            console.log("Success! Output length:", res.content[1].text.length);
        } catch (e) {
            console.error("Conversion failed:", e.message);
            if (e.stack) console.error(e.stack.split('\n').slice(0, 3).join('\n'));
        }
    }
    // Mock logging
  },
  sendLoggingMessage: async () => {}
};

(async () => {
    registerSvgTool(mockServer);
})();
