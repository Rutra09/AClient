#ifndef ENGINE_CLIENT_CLOUD_H
#define ENGINE_CLIENT_CLOUD_H

#include <engine/client/client.h>
#include <engine/shared/http.h>
#include <engine/storage.h>
#include <string>

class CCloud
{
	class IClient *m_pClient;
	class IEngine *m_pEngine;
	class IHttp *m_pHttp;
	class IStorage *m_pStorage;
	class IConfigManager *m_pConfigManager;

	char m_aToken[512];
	char m_aUsername[64];

	std::shared_ptr<IHttpRequest> m_pLoginRequest;
	std::shared_ptr<IHttpRequest> m_pRegisterRequest;
	std::shared_ptr<IHttpRequest> m_pSettingsRequest;
	std::shared_ptr<IHttpRequest> m_pAssetRequest;

	bool m_UploadSettings; // True if uploading, false if downloading

public:
	CCloud(IClient *pClient, IEngine *pEngine, IHttp *pHttp, IStorage *pStorage, IConfigManager *pConfigManager);

	void Login(const char *pUser, const char *pPass);
	void Register(const char *pUser, const char *pPass);
	void SyncSettings(bool Upload);
	void UploadAsset(const char *pFilename);
	void DownloadAsset(const char *pFilename);

	void Update();
};

#endif
