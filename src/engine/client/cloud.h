#ifndef ENGINE_CLIENT_CLOUD_H
#define ENGINE_CLIENT_CLOUD_H

#include <engine/client/client.h>
#include <engine/shared/http.h>
#include <engine/storage.h>
#include <engine/cloud.h>
#include <engine/console.h>
#include <string>
#include <vector>

class IGameClient;

class CCloud : public ICloud
{
	class IClient *m_pClient;
	class IEngine *m_pEngine;
	class IHttp *m_pHttp;
	class IStorage *m_pStorage;
	class IConfigManager *m_pConfigManager;
	class IConsole *m_pConsole;
	class IGameClient *m_pGameClient;

	char m_aToken[512];
	char m_aUsername[64];
	char m_aStatusMessage[256];

	std::shared_ptr<IHttpRequest> m_pLoginRequest;
	std::shared_ptr<IHttpRequest> m_pRegisterRequest;
	std::shared_ptr<IHttpRequest> m_pSettingsRequest;
	std::shared_ptr<IHttpRequest> m_pAssetUploadRequest;
	std::shared_ptr<IHttpRequest> m_pAssetDownloadRequest;
	std::shared_ptr<IHttpRequest> m_pInventoryRequest;

	// Queue for downloads
	struct SDownloadRequest
	{
		char m_aFilename[256];
		std::shared_ptr<IHttpRequest> m_pRequest;
	};
	std::vector<SDownloadRequest> m_vDownloadQueue;

	bool m_UploadSettings; // True if uploading, false if downloading

public:
	struct SInventoryAsset
	{
		char m_aFilename[128];
		char m_aLocalPath[256];
		int m_LatestVersion;
		int m_VersionCount;
		int m_TotalSize;
		char m_aLastUpdated[64];
	};

	CCloud(IClient *pClient, IEngine *pEngine, IHttp *pHttp, IStorage *pStorage, IConfigManager *pConfigManager, IConsole *pConsole);

	void SetGameClient(IGameClient *pGameClient) { m_pGameClient = pGameClient; }

	void Login(const char *pUser, const char *pPass) override;
	void Register(const char *pUser, const char *pPass) override;
	void SyncSettings(bool Upload) override;
	void UploadAsset(const char *pFilename) override;
	void UploadAssetFolder(const char *pFolderPath) override;
	void DownloadAsset(const char *pFilename) override;

	bool IsLoggedIn() const override;
	const char *GetStatusMessage() const override;
	void GetInventory() override;

	// Inventory access
	int GetInventoryCount() const { return m_vInventory.size(); }
	const SInventoryAsset *GetInventoryAsset(int Index) const;

	void Update();

private:
	std::vector<SInventoryAsset> m_vInventory;
};

#endif
