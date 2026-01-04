#ifndef ENGINE_CLOUD_H
#define ENGINE_CLOUD_H

#include <engine/kernel.h>

class ICloud : public IInterface
{
	MACRO_INTERFACE("cloud")
public:
	virtual void Login(const char *pUser, const char *pPass) = 0;
	virtual void Register(const char *pUser, const char *pPass) = 0;
	virtual void SyncSettings(bool Upload) = 0;
	virtual void UploadAsset(const char *pFilename) = 0;
	virtual void UploadAssetFolder(const char *pFolderPath) = 0;
	virtual void DownloadAsset(const char *pFilename) = 0;

	virtual bool IsLoggedIn() const = 0;
	virtual const char *GetStatusMessage() const = 0;
	virtual void GetInventory() = 0;
};

#endif
