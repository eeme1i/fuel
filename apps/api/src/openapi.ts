export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Finnish Fuel Trend API",
    version: "2.0.0",
    description:
      "Public estimates, daily history, monthly Finnish observations, and model backtests. Estimates use a U.S. finished-product proxy and are not observed filling-station prices.",
  },
  servers: [{ url: "https://api.fuel.eeru.net" }],
  // Anonymous access is allowed; an approved key raises the rate limit.
  security: [{}, { ApiKey: [] }],
  tags: [
    { name: "Fuel", description: "Current and historical fuel estimates" },
    { name: "Model", description: "Model evaluation" },
  ],
  paths: {
    "/api/v1/fuel/{fuel}": {
      get: {
        tags: ["Fuel"],
        summary: "Get the latest fuel-price estimate",
        parameters: [{ $ref: "#/components/parameters/Fuel" }],
        responses: {
          "200": {
            description: "Current anchored estimate",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FuelEstimate" },
              },
            },
          },
          "404": { $ref: "#/components/responses/UnsupportedFuel" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": {
            description: "Required source observations have not been ingested",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/v1/fuel/{fuel}/history": {
      get: {
        tags: ["Fuel"],
        summary: "Get daily estimates and monthly reported prices",
        description:
          "Stored daily snapshots are returned separately from retrospective daily and monthly reconstructions.",
        parameters: [{ $ref: "#/components/parameters/Fuel" }],
        responses: {
          "200": {
            description: "Historical series",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FuelHistory" },
              },
            },
          },
          "404": { $ref: "#/components/responses/UnsupportedFuel" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/v1/backtests/{fuel}": {
      get: {
        tags: ["Model"],
        summary: "Get model backtest metrics",
        description:
          "Out-of-sample monthly backtest: each official month is predicted from the previous month with beta fitted only on earlier months, and compared with a no-change baseline.",
        parameters: [{ $ref: "#/components/parameters/Fuel" }],
        responses: {
          "200": {
            description: "Backtest metrics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    fuel: { type: "string", enum: ["95E10", "DIESEL"] },
                    metrics: { $ref: "#/components/schemas/Backtest" },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/UnsupportedFuel" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "503": {
            description: "Insufficient observations for a backtest",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description:
          "Optional. Approved clients get 1000 requests/minute per key; anonymous clients get 60 requests/minute per IP. An unknown key is rejected with 401.",
      },
    },
    parameters: {
      Fuel: {
        name: "fuel",
        in: "path",
        required: true,
        schema: { type: "string", enum: ["95e10", "diesel"] },
      },
    },
    responses: {
      RateLimited: {
        description: "Rate limit exceeded; see the Retry-After header",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
      UnsupportedFuel: {
        description: "Unsupported fuel identifier",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          message: { type: "string" },
          supported: { type: "array", items: { type: "string" } },
        },
      },
      Confidence: { type: "string", enum: ["high", "medium", "low"] },
      Backtest: {
        type: "object",
        properties: {
          samples: { type: "integer" },
          from: { type: "string", format: "date" },
          to: { type: "string", format: "date" },
          mae: { type: "number", description: "Mean absolute error, EUR/L" },
          rmse: { type: "number" },
          bias: { type: "number" },
          maxAbsoluteError: { type: "number" },
          errorBound80: {
            type: "number",
            description: "80th percentile of absolute errors",
          },
          correlation: { type: ["number", "null"] },
          directionAccuracy: { type: "number" },
          naiveMae: {
            type: "number",
            description: "MAE of assuming no change since the previous month",
          },
          naiveRmse: { type: "number" },
          skill: { type: "number", description: "1 − mae / naiveMae" },
          beta: { type: "number" },
          calibrationSamples: { type: "integer" },
          benchmark: { type: "string" },
          lagDays: { type: "integer" },
          windowDays: { type: "integer" },
        },
      },
      DailyEstimate: {
        type: "object",
        required: ["timestamp", "price", "confidence", "model_version"],
        properties: {
          timestamp: { type: "string", format: "date-time" },
          price: { type: "number", description: "EUR per litre" },
          confidence: { $ref: "#/components/schemas/Confidence" },
          model_version: { type: "string" },
        },
      },
      ReconstructedDailyEstimate: {
        type: "object",
        required: ["date", "price", "confidence", "anchor_date", "kind"],
        properties: {
          date: { type: "string", format: "date" },
          price: { type: "number", description: "EUR per litre" },
          confidence: { $ref: "#/components/schemas/Confidence" },
          anchor_date: { type: "string", format: "date" },
          kind: { type: "string", const: "reconstructed" },
        },
      },
      OfficialPrice: {
        type: "object",
        required: ["date", "price", "source"],
        properties: {
          date: { type: "string", format: "date" },
          price: { type: "number", description: "EUR per litre" },
          source: { type: "string" },
        },
      },
      FuelEstimate: {
        type: "object",
        required: [
          "fuel",
          "country",
          "currency",
          "unit",
          "estimate",
          "official",
        ],
        properties: {
          fuel: { type: "string", enum: ["95E10", "DIESEL"] },
          country: { type: "string", const: "FI" },
          currency: { type: "string", const: "EUR" },
          unit: { type: "string", const: "litre" },
          estimate: {
            type: "object",
            properties: {
              price: { type: "number" },
              changeSinceAnchor: { type: "number" },
              range: {
                type: ["object", "null"],
                description:
                  "Range expected to contain the Finnish average with the stated coverage, from out-of-sample errors",
                properties: {
                  low: { type: "number" },
                  high: { type: "number" },
                  coverage: { type: "number", example: 0.8 },
                },
              },
              confidence: { $ref: "#/components/schemas/Confidence" },
              timestamp: { type: "string", format: "date-time" },
            },
          },
          official: {
            type: "object",
            properties: {
              price: { type: "number" },
              date: { type: "string", format: "date" },
              source: { type: "string" },
              ageDays: { type: "integer" },
            },
          },
          components: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          calculation: { type: "object", additionalProperties: true },
          marketDataAgeDays: { type: "integer" },
          model: { type: "object", additionalProperties: true },
          disclaimer: { type: "string" },
        },
      },
      FuelHistory: {
        type: "object",
        required: [
          "fuel",
          "unit",
          "estimates",
          "official",
          "reconstructedDaily",
        ],
        properties: {
          fuel: { type: "string", enum: ["95E10", "DIESEL"] },
          unit: { type: "string", example: "EUR/litre" },
          estimates: {
            type: "array",
            description:
              "Actual stored model calculations, at most one per UTC day",
            items: { $ref: "#/components/schemas/DailyEstimate" },
          },
          reconstructedDaily: {
            type: "array",
            description: "Retrospective daily model reconstruction",
            items: { $ref: "#/components/schemas/ReconstructedDailyEstimate" },
          },
          official: {
            type: "array",
            items: { $ref: "#/components/schemas/OfficialPrice" },
          },
          modelVersion: {
            type: "string",
            description:
              "Model version of the reconstruction; stored estimates may come from older versions",
          },
          weekly: {
            type: "array",
            description:
              "Finnish weekly pump prices from the EU Weekly Oil Bulletin, in force on each Monday",
            items: {
              type: "object",
              properties: {
                date: { type: "string", format: "date" },
                price: { type: "number" },
                source: { type: "string" },
              },
            },
          },
          reconstructed: {
            type: "array",
            description: "Out-of-sample monthly predictions",
            items: { type: "object" },
          },
          backtest: {
            oneOf: [
              { $ref: "#/components/schemas/Backtest" },
              { type: "null" },
            ],
          },
          comparisons: { type: "array", items: { type: "object" } },
        },
      },
    },
  },
} as const;

export const swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Finnish Fuel Trend API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,displayRequestDuration:true});</script>
</body>
</html>`;
