// Alias table mapping common phrasings (as written by people and AI agents)
// to canonical Azure icon service names (lowercase file-name segment, e.g.
// "app-services"). Shared by the browser icon registry
// (src/utils/azureIconRegistry.ts) and the server-side icon search used by the
// MCP server, so both resolve the same phrases to the same icons.

import { AZURE_ICON_ALIASES } from '../../assets/icon-mappings/azure-icon-aliases.js'

export const AZURE_ALIASES: Record<string, string> = {
  // App Services
  'app service': 'app-services',
  'web app': 'app-services',
  'azure web app': 'app-services',

  // Function Apps
  'functions': 'function-apps',
  'azure functions': 'function-apps',
  'function app': 'function-apps',
  'serverless function': 'function-apps',
  'serverless functions': 'function-apps',

  // Key Vault
  'key vault': 'key-vaults',
  'keyvault': 'key-vaults',
  'azure key vault': 'key-vaults',

  // Storage
  'storage': 'storage-accounts',
  'storage account': 'storage-accounts',
  'blob storage': 'storage-accounts',
  'azure storage': 'storage-accounts',
  'azure blob storage': 'storage-accounts',
  'azure blob': 'storage-accounts',

  // Virtual Machines
  'vm': 'virtual-machine',
  'virtual machine': 'virtual-machine',
  'azure vm': 'virtual-machine',

  // SQL Database
  'sql': 'sql-database',
  'sql database': 'sql-database',
  'azure sql': 'sql-database',
  'azure sql database': 'sql-database',
  'sql db': 'sql-database',

  // Cosmos DB
  'cosmos db': 'azure-cosmos-db',
  'cosmosdb': 'azure-cosmos-db',
  'cosmos': 'azure-cosmos-db',
  'azure cosmos db': 'azure-cosmos-db',
  'azure cosmos': 'azure-cosmos-db',
  'azure cosmosdb': 'azure-cosmos-db',

  // Kubernetes / AKS
  'aks': 'kubernetes-services',
  'kubernetes': 'kubernetes-services',
  'azure kubernetes': 'kubernetes-services',
  'azure kubernetes service': 'kubernetes-services',
  'k8s': 'kubernetes-services',

  // API Management
  'api management': 'api-management-services',
  'apim': 'api-management-services',
  'azure api management': 'api-management-services',

  // Application Insights
  'application insights': 'application-insights',
  'app insights': 'application-insights',

  // Load Balancer
  'load balancer': 'load-balancers',
  'azure load balancer': 'load-balancers',

  // Virtual Network
  'vnet': 'virtual-networks',
  'virtual network': 'virtual-networks',
  'azure vnet': 'virtual-networks',

  // Service Bus
  'service bus': 'azure-service-bus',
  'azure service bus': 'azure-service-bus',

  // Logic Apps
  'logic app': 'logic-apps',
  'logic apps': 'logic-apps',
  'azure logic apps': 'logic-apps',
  'azure logic app': 'logic-apps',

  // Application Gateway
  'application gateway': 'application-gateways',
  'app gateway': 'application-gateways',
  'azure application gateway': 'application-gateways',

  // Event Hubs
  'event hub': 'event-hubs',
  'event hubs': 'event-hubs',
  'azure event hubs': 'event-hubs',
  'azure event hub': 'event-hubs',

  // Redis Cache
  'redis': 'cache-redis',
  'redis cache': 'cache-redis',
  'azure cache for redis': 'cache-redis',
  'azure redis': 'cache-redis',
  'azure cache': 'cache-redis',

  // Entra ID / Azure AD
  'entra': 'entra-id',
  'entra id': 'entra-id',
  'azure ad': 'entra-id',
  'azure active directory': 'entra-id',
  'active directory': 'entra-id',
  'aad': 'entra-id',

  // Container Instances
  'container instance': 'container-instances',
  'container instances': 'container-instances',
  'aci': 'container-instances',
  'azure container instances': 'container-instances',

  // Container Registry
  'container registry': 'container-registries',
  'acr': 'container-registries',
  'azure container registry': 'container-registries',

  // Front Door
  'front door': 'front-door-and-cdn-profiles',
  'azure front door': 'front-door-and-cdn-profiles',
  'frontdoor': 'front-door-and-cdn-profiles',

  // Azure OpenAI
  'openai': 'azure-openai',
  'azure openai': 'azure-openai',
  'gpt': 'azure-openai',
  'azure openai service': 'azure-openai',

  // Cognitive Services
  'cognitive services': 'cognitive-services',
  'azure cognitive services': 'cognitive-services',
  'ai services': 'cognitive-services',

  // AI Studio
  'ai studio': 'ai-studio',
  'azure ai studio': 'ai-studio',

  // Bot Service
  'bot service': 'bot-services',
  'azure bot service': 'bot-services',
  'bot': 'bot-services',

  // Machine Learning
  'machine learning': 'machine-learning',
  'azure ml': 'machine-learning',
  'azure machine learning': 'machine-learning',
  'ml': 'machine-learning',

  // DevOps
  'devops': 'azure-devops',
  'azure devops': 'azure-devops',

  // Data Factory
  'data factory': 'data-factories',
  'adf': 'data-factories',
  'azure data factory': 'data-factories',

  // Databricks
  'databricks': 'azure-databricks',
  'azure databricks': 'azure-databricks',

  // Synapse Analytics
  'synapse': 'azure-synapse-analytics',
  'synapse analytics': 'azure-synapse-analytics',
  'azure synapse': 'azure-synapse-analytics',

  // Sentinel
  'sentinel': 'azure-sentinel',
  'azure sentinel': 'azure-sentinel',
  'microsoft sentinel': 'azure-sentinel',

  // Defender for Cloud
  'defender': 'microsoft-defender-for-cloud',
  'defender for cloud': 'microsoft-defender-for-cloud',
  'security center': 'microsoft-defender-for-cloud',
  'azure security center': 'microsoft-defender-for-cloud',

  // Firewall
  'firewall': 'firewalls',
  'azure firewall': 'firewalls',

  // DNS
  'dns': 'dns-zones',
  'azure dns': 'dns-zones',

  // CDN
  'cdn': 'cdn-profiles',
  'azure cdn': 'cdn-profiles',
  'content delivery network': 'cdn-profiles',

  // ExpressRoute
  'expressroute': 'expressroute-circuits',
  'express route': 'expressroute-circuits',
  'azure expressroute': 'expressroute-circuits',

  // SignalR
  'signalr': 'signalr',
  'azure signalr': 'signalr',

  // Static Web Apps
  'static web app': 'static-apps',
  'static web apps': 'static-apps',
  'static app': 'static-apps',
  'swa': 'static-apps',

  // Spring Apps
  'spring apps': 'azure-spring-apps',
  'azure spring apps': 'azure-spring-apps',
  'spring cloud': 'azure-spring-apps',

  // PostgreSQL
  'postgresql': 'azure-database-postgresql-server',
  'postgres': 'azure-database-postgresql-server',
  'azure postgresql': 'azure-database-postgresql-server',
  'azure database for postgresql': 'azure-database-postgresql-server',

  // MySQL
  'mysql': 'azure-database-mysql-server',
  'azure mysql': 'azure-database-mysql-server',
  'azure database for mysql': 'azure-database-mysql-server',

  // Event Grid
  'event grid': 'event-grid-topics',
  'azure event grid': 'event-grid-topics',

  // Service Fabric
  'service fabric': 'service-fabric-clusters',
  'azure service fabric': 'service-fabric-clusters',

  // Batch
  'batch': 'batch-accounts',
  'azure batch': 'batch-accounts',

  // Notification Hubs
  'notification hub': 'notification-hubs',
  'notification hubs': 'notification-hubs',
  'push notifications': 'notification-hubs',

  // VPN Gateway
  'vpn': 'virtual-network-gateways',
  'vpn gateway': 'virtual-network-gateways',
  'azure vpn': 'virtual-network-gateways',

  // Bastion
  'bastion': 'bastions',
  'azure bastion': 'bastions',

  // NAT Gateway
  'nat gateway': 'nat',
  'nat': 'nat',

  // DDoS Protection
  'ddos': 'ddos-protection-plans',
  'ddos protection': 'ddos-protection-plans',

  // VM Scale Sets
  'vm scale set': 'vm-scale-sets',
  'vmss': 'vm-scale-sets',
  'scale set': 'vm-scale-sets',
  'virtual machine scale set': 'vm-scale-sets',

  // App Configuration
  'app configuration': 'app-configuration',
  'azure app configuration': 'app-configuration',

  // Cognitive Search / AI Search
  'cognitive search': 'cognitive-search',
  'ai search': 'cognitive-search',
  'azure search': 'cognitive-search',
  'azure ai search': 'cognitive-search',

  // Speech Services
  'speech': 'speech-services',
  'speech service': 'speech-services',
  'azure speech': 'speech-services',

  // Form Recognizer
  'form recognizer': 'form-recognizers',
  'document intelligence': 'form-recognizers',
  'azure form recognizer': 'form-recognizers',

  // Computer Vision
  'computer vision': 'computer-vision',
  'azure computer vision': 'computer-vision',

  // Content Safety
  'content safety': 'content-safety',
  'azure content safety': 'content-safety',

  // Monitor / Application Insights overlap
  'monitor': 'application-insights',
  'azure monitor': 'application-insights',

  // Data Lake
  'data lake': 'data-lake-storage-gen1',
  'azure data lake': 'data-lake-storage-gen1',

  // NetApp
  'netapp': 'azure-netapp-files',
  'azure netapp files': 'azure-netapp-files',

  // Power BI
  'power bi': 'power-bi-embedded',
  'powerbi': 'power-bi-embedded',

  // Intune
  'intune': 'intune',
  'azure intune': 'intune',
  'microsoft intune': 'intune',

  // Network Security Group
  'nsg': 'network-security-groups',
  'network security group': 'network-security-groups',

  // Traffic Manager
  'traffic manager': 'traffic-manager-profiles',
  'azure traffic manager': 'traffic-manager-profiles',

  // WAF
  'waf': 'web-application-firewall-policies(waf)',
  'web application firewall': 'web-application-firewall-policies(waf)',

  // Relay
  'relay': 'relays',
  'azure relay': 'relays',

  // IoT Hub (check iot directory)
  'iot hub': 'iot-hub',
  'iot': 'iot-hub',
  'azure iot hub': 'iot-hub',
  'azure iot': 'iot-hub',

  // Extended aliases from comprehensive mapping
  ...AZURE_ICON_ALIASES,
}
