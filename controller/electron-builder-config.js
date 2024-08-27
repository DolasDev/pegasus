module.exports = {
  npmRebuild: false,
  appId: "pegII.services",
  productName: "PegII Services Controller",
  extends: null,
  icon: "./icon/controller.ico",
  asar: true,
  files: ["./**/*"],
  extraResources : ["nssm.exe",{from: "../service/pegII-service.exe", to:"pegII-service.exe"}],
  directories: {
    buildResources: "assets"
  },
  win: {
    requestedExecutionLevel: "requireAdministrator",
    target: "nsis",
    icon: "./icon/controller.ico",
    publish: {
      provider: "s3",
      bucket: "tbd"
    }
  },
  nsis: {
    installerIcon: "./icon/controller.ico",
  },
  generateUpdatesFilesForAllChannels: true
}
