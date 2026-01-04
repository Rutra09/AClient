#include "cloud.h"
#include <engine/external/json-parser/json.h>
#include <engine/shared/jsonwriter.h>
#include <engine/shared/http.h>
#include <base/system.h>
#include <base/log.h>

static const char *BASE_URL = "http://localhost:3000/api";

CCloud::CCloud(IClient *pClient, IEngine *pEngine, IHttp *pHttp, IStorage *pStorage, IConfigManager *pConfigManager, IConsole *pConsole) :
	m_pClient(pClient),
	m_pEngine(pEngine),
	m_pHttp(pHttp),
	m_pStorage(pStorage),
	m_pConfigManager(pConfigManager),
	m_pConsole(pConsole),
	m_pGameClient(nullptr)
{
	m_aToken[0] = 0;
	m_aUsername[0] = 0;
	str_copy(m_aStatusMessage, "Not logged in", sizeof(m_aStatusMessage));
	m_UploadSettings = false;
}

void CCloud::Login(const char *pUser, const char *pPass)
{
	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/auth/login", BASE_URL);

	CJsonStringWriter Writer;
	Writer.BeginObject();
	Writer.WriteAttribute("username");
	Writer.WriteStrValue(pUser);
	Writer.WriteAttribute("password");
	Writer.WriteStrValue(pPass);
	Writer.EndObject();

	m_pLoginRequest = std::move(HttpPostJson(aUrl, Writer.GetOutputString().c_str()));
	m_pHttp->Run(m_pLoginRequest);
	str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Logging in as %s...", pUser);
	log_info("cloud", "Logging in as %s...", pUser);
}

void CCloud::Register(const char *pUser, const char *pPass)
{
	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/auth/register", BASE_URL);

	CJsonStringWriter Writer;
	Writer.BeginObject();
	Writer.WriteAttribute("username");
	Writer.WriteStrValue(pUser);
	Writer.WriteAttribute("password");
	Writer.WriteStrValue(pPass);
	Writer.EndObject();

	m_pRegisterRequest = std::move(HttpPostJson(aUrl, Writer.GetOutputString().c_str()));
	m_pHttp->Run(m_pRegisterRequest);
	str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Registering as %s...", pUser);
	log_info("cloud", "Registering as %s...", pUser);
}

void CCloud::SyncSettings(bool Upload)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/settings", BASE_URL);

	m_UploadSettings = Upload;
	std::shared_ptr<CHttpRequest> pRequest;

	if(Upload)
	{
		std::string Json = m_pConfigManager->SaveToJSON();
		// Wrap in "settings" object if needed, but SaveToJSON already does that?
		// SaveToJSON returns { "settings": { ... } }
		// Backend expects { "settings": { ... } }
		// So it matches.
		pRequest = std::move(HttpPostJson(aUrl, Json.c_str()));
	}
	else
	{
		pRequest = std::move(HttpGet(aUrl));
	}
	
	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);

	m_pSettingsRequest = pRequest;
	m_pHttp->Run(m_pSettingsRequest);
	log_info("cloud", "Syncing settings (%s)...", Upload ? "Upload" : "Download");
}

void CCloud::UploadAsset(const char *pFilename)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	void *pBuf;
	unsigned Length;
	if(!m_pStorage->ReadFile(pFilename, IStorage::TYPE_ALL, &pBuf, &Length))
	{
		log_error("cloud", "Failed to read asset file: %s", pFilename);
		return;
	}

	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/assets", BASE_URL);

	auto pRequest = HttpPost(aUrl, (const unsigned char *)pBuf, Length);
	free(pBuf);

	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);
	pRequest->HeaderString("X-Filename", pFilename);
	pRequest->HeaderString("X-Local-Path", pFilename); // Store original path
	pRequest->HeaderString("Content-Type", "application/octet-stream");

	m_pAssetUploadRequest = std::move(pRequest);
	m_pHttp->Run(m_pAssetUploadRequest);
	log_info("cloud", "Uploading asset: %s...", pFilename);
}

// Helper structure for folder upload callback
struct SFolderUploadContext
{
	CCloud *m_pCloud;
	char m_aFolderPath[512];
	int m_FileCount;
};

// Callback for directory listing
static int FolderUploadCallback(const char *pName, int IsDir, int StorageType, void *pUser)
{
	if(IsDir)
		return 0; // Skip directories
	
	SFolderUploadContext *pContext = (SFolderUploadContext *)pUser;
	
	// Build full relative path
	char aFullPath[512];
	str_format(aFullPath, sizeof(aFullPath), "%s/%s", pContext->m_aFolderPath, pName);
	
	// Upload the file
	pContext->m_pCloud->UploadAsset(aFullPath);
	pContext->m_FileCount++;
	
	return 0;
}

void CCloud::UploadAssetFolder(const char *pFolderPath)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	// Create context for callback
	SFolderUploadContext Context;
	Context.m_pCloud = this;
	str_copy(Context.m_aFolderPath, pFolderPath, sizeof(Context.m_aFolderPath));
	Context.m_FileCount = 0;
	
	// List all files in the directory
	m_pStorage->ListDirectory(IStorage::TYPE_ALL, pFolderPath, FolderUploadCallback, &Context);
	
	if(Context.m_FileCount > 0)
	{
		str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Uploading %d files from %s", Context.m_FileCount, pFolderPath);
		log_info("cloud", "Queued %d files from %s for upload", Context.m_FileCount, pFolderPath);
	}
	else
	{
		str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "No files found in %s", pFolderPath);
		log_warn("cloud", "No files found in folder: %s", pFolderPath);
	}
}

void CCloud::DownloadAsset(const char *pFilename)
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	char aUrl[256];
	char aEscaped[256];
	EscapeUrl(aEscaped, pFilename);
	str_format(aUrl, sizeof(aUrl), "%s/assets/%s", BASE_URL, aEscaped);

	std::shared_ptr<CHttpRequest> pRequest = HttpGet(aUrl);
	
	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);

	// Find the asset in inventory to get its local_path
	char aLocalPath[512];
	str_copy(aLocalPath, pFilename, sizeof(aLocalPath)); // Default fallback
	
	for(const auto &Asset : m_vInventory)
	{
		if(str_comp(Asset.m_aFilename, pFilename) == 0)
		{
			str_copy(aLocalPath, Asset.m_aLocalPath, sizeof(aLocalPath));
			break;
		}
	}

	// Add to download queue
	SDownloadRequest DownloadReq;
	str_copy(DownloadReq.m_aFilename, aLocalPath, sizeof(DownloadReq.m_aFilename));
	DownloadReq.m_pRequest = pRequest;
	m_vDownloadQueue.push_back(DownloadReq);
	
	m_pHttp->Run(pRequest);
	log_info("cloud", "Downloading asset: %s -> %s", pFilename, aLocalPath);
}

void CCloud::Update()
{
	if(m_pLoginRequest && m_pLoginRequest->State() != EHttpState::QUEUED && m_pLoginRequest->State() != EHttpState::RUNNING)
	{
		if(m_pLoginRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pLoginRequest.get())->ResultJson();
			if(pJson)
			{
				const json_value &Token = (*pJson)["token"];
				if(Token.type == json_string)
				{
					str_copy(m_aToken, Token.u.string.ptr, sizeof(m_aToken));
					str_copy(m_aStatusMessage, "Logged in successfully", sizeof(m_aStatusMessage));
					log_info("cloud", "Login successful");
					SyncSettings(false); // Auto-sync download
					GetInventory(); // Load inventory
				}
				else
				{
					str_copy(m_aStatusMessage, "Login failed: Invalid response", sizeof(m_aStatusMessage));
					log_error("cloud", "Login failed: Invalid response");
				}
				json_value_free(pJson);
			}
			else
			{
				str_copy(m_aStatusMessage, "Login failed: No response", sizeof(m_aStatusMessage));
				log_error("cloud", "Login failed: No response");
			}
		}
		else
		{
			str_copy(m_aStatusMessage, "Login failed: Request error", sizeof(m_aStatusMessage));
			log_error("cloud", "Login failed: Request error");
		}
		m_pLoginRequest = nullptr;
	}

	if(m_pRegisterRequest && m_pRegisterRequest->State() != EHttpState::QUEUED && m_pRegisterRequest->State() != EHttpState::RUNNING)
	{
		if(m_pRegisterRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pRegisterRequest.get())->ResultJson();
			if(pJson)
			{
				const json_value &Token = (*pJson)["token"];
				if(Token.type == json_string)
				{
					str_copy(m_aToken, Token.u.string.ptr, sizeof(m_aToken));
					str_copy(m_aStatusMessage, "Registered successfully", sizeof(m_aStatusMessage));
					log_info("cloud", "Registration successful");
					SyncSettings(false);
				}
				else
				{
					str_copy(m_aStatusMessage, "Registration failed", sizeof(m_aStatusMessage));
					log_error("cloud", "Registration failed");
				}
				json_value_free(pJson);
			}
		}
		m_pRegisterRequest = nullptr;
	}

	if(m_pSettingsRequest && m_pSettingsRequest->State() != EHttpState::QUEUED && m_pSettingsRequest->State() != EHttpState::RUNNING)
	{
		if(m_pSettingsRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pSettingsRequest.get())->ResultJson();
			if(pJson)
			{
				if(m_UploadSettings)
				{
					str_copy(m_aStatusMessage, "Settings uploaded", sizeof(m_aStatusMessage));
					log_info("cloud", "Settings uploaded successfully");
				}
				else
				{
					m_pConfigManager->LoadFromJSON(pJson);
					// Save all config domains to disk
					m_pConfigManager->Save();
					str_copy(m_aStatusMessage, "Settings downloaded and applied", sizeof(m_aStatusMessage));
					log_info("cloud", "Settings downloaded, applied, and saved to disk");
				}
				json_value_free(pJson);
			}
			else
			{
				str_copy(m_aStatusMessage, "Settings sync failed", sizeof(m_aStatusMessage));
				log_error("cloud", "Settings sync failed: Invalid JSON");
			}
		}
		else
		{
			str_copy(m_aStatusMessage, "Settings sync failed", sizeof(m_aStatusMessage));
			log_error("cloud", "Settings sync failed: Request error");
		}
		m_pSettingsRequest = nullptr;
	}

	// Handle asset upload
	if(m_pAssetUploadRequest && m_pAssetUploadRequest->State() != EHttpState::QUEUED && m_pAssetUploadRequest->State() != EHttpState::RUNNING)
	{
		if(m_pAssetUploadRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pAssetUploadRequest.get())->ResultJson();
			if(pJson && pJson->type == json_object)
			{
				const json_value &Msg = (*pJson)["message"];
				if(Msg.type == json_string)
				{
					str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Upload: %s", Msg.u.string.ptr);
					log_info("cloud", "Asset upload successful: %s", Msg.u.string.ptr);
				}
				json_value_free(pJson);
				// Refresh inventory after upload
				GetInventory();
			}
			else
			{
				log_info("cloud", "Asset uploaded");
				GetInventory();
			}
		}
		else
		{
			log_error("cloud", "Asset upload failed");
		}
		m_pAssetUploadRequest = nullptr;
	}

	// Handle asset downloads
	for(auto it = m_vDownloadQueue.begin(); it != m_vDownloadQueue.end();)
	{
		if(it->m_pRequest->State() != EHttpState::QUEUED && it->m_pRequest->State() != EHttpState::RUNNING)
		{
			if(it->m_pRequest->State() == EHttpState::DONE)
			{
				unsigned char *pData;
				size_t DataSize;
				((CHttpRequest*)it->m_pRequest.get())->Result(&pData, &DataSize);

				if(pData && DataSize > 0)
				{
					// Extract directory path from filename and create it
					char aDirectory[512];
					str_copy(aDirectory, it->m_aFilename, sizeof(aDirectory));
					
					// Find the last directory separator
					char *pLastSlash = nullptr;
					for(char *p = aDirectory; *p; p++)
					{
						if(*p == '/' || *p == '\\')
							pLastSlash = p;
					}
					
					// Create directory structure if needed
					if(pLastSlash)
					{
						*pLastSlash = 0; // Terminate string at last separator
						
						// Create all directories in the path
						char aCurrentPath[512] = {0};
						char *pToken = aDirectory;
						char *pNext = pToken;
						
						while(*pNext)
						{
							// Find next separator
							while(*pNext && *pNext != '/' && *pNext != '\\')
								pNext++;
							
							// Copy this path segment
							int Len = pNext - pToken;
							if(Len > 0)
							{
								if(aCurrentPath[0])
									str_append(aCurrentPath, "/", sizeof(aCurrentPath));
								strncat(aCurrentPath, pToken, Len);
								
								// Create this directory
								if(!m_pStorage->FolderExists(aCurrentPath, IStorage::TYPE_SAVE))
								{
									m_pStorage->CreateFolder(aCurrentPath, IStorage::TYPE_SAVE);
									log_debug("cloud", "Created directory: %s", aCurrentPath);
								}
							}
							
							// Skip separator
							if(*pNext)
							{
								pNext++;
								pToken = pNext;
							}
						}
					}
					
					// Now save the file
					IOHANDLE File = m_pStorage->OpenFile(it->m_aFilename, IOFLAG_WRITE, IStorage::TYPE_SAVE);
					if(File)
					{
						io_write(File, pData, DataSize);
						io_close(File);
						
						// Get the full path for logging
						char aFullPath[1024];
						m_pStorage->GetCompletePath(IStorage::TYPE_SAVE, it->m_aFilename, aFullPath, sizeof(aFullPath));
						
						str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Downloaded: %s (%d bytes)", it->m_aFilename, (int)DataSize);
						log_info("cloud", "Asset downloaded and saved: %s (%d bytes) -> %s", it->m_aFilename, (int)DataSize, aFullPath);
						
						// Auto-execute .cfg files
						if(str_endswith(it->m_aFilename, ".cfg"))
						{
							if(m_pConsole)
							{
								m_pConsole->ExecuteFile(it->m_aFilename, -1, false, IStorage::TYPE_SAVE);
								log_info("cloud", "Auto-executed config file: %s", it->m_aFilename);
							}
						}
						// Auto-reload JSON files
						else if(str_endswith(it->m_aFilename, ".json"))
						{
							if(m_pGameClient)
							{
								// Reload touch controls if it's that file
								if(str_find(it->m_aFilename, "touch_controls.json"))
								{
									log_info("cloud", "Reloading touch_controls.json");
									// Touch controls will be reloaded on next init
								}
								else if(str_find(it->m_aFilename, "identities.json"))
								{
									log_info("cloud", "Reloading identities.json");
									// Identities will be reloaded on next access
								}
							}
							log_info("cloud", "Downloaded JSON file: %s (reload may require restart)", it->m_aFilename);
						}
					}
					else
					{
						log_error("cloud", "Failed to open file for writing: %s", it->m_aFilename);
					}
				}
				else
				{
					log_error("cloud", "Download failed for: %s (no data)", it->m_aFilename);
				}
			}
			else
			{
				log_error("cloud", "Download failed for: %s", it->m_aFilename);
			}
			it = m_vDownloadQueue.erase(it);
		}
		else
		{
			++it;
		}
	}

	// Handle inventory request
	if(m_pInventoryRequest && m_pInventoryRequest->State() != EHttpState::QUEUED && m_pInventoryRequest->State() != EHttpState::RUNNING)
	{
		if(m_pInventoryRequest->State() == EHttpState::DONE)
		{
			json_value *pJson = ((CHttpRequest*)m_pInventoryRequest.get())->ResultJson();
			if(pJson)
			{
				m_vInventory.clear();
				
				const json_value &Assets = (*pJson)["assets"];
				if(Assets.type == json_array)
				{
					for(unsigned i = 0; i < Assets.u.array.length; i++)
					{
						const json_value &Asset = Assets[i];
						SInventoryAsset Item;
						
						const json_value &Filename = Asset["filename"];
					const json_value &LocalPath = Asset["local_path"];
					const json_value &Version = Asset["latest_version"];
					const json_value &VersionCount = Asset["version_count"];
					const json_value &Size = Asset["total_size"];
					const json_value &Updated = Asset["last_updated"];
					
					if(Filename.type == json_string)
						str_copy(Item.m_aFilename, Filename.u.string.ptr, sizeof(Item.m_aFilename));
					if(LocalPath.type == json_string)
						str_copy(Item.m_aLocalPath, LocalPath.u.string.ptr, sizeof(Item.m_aLocalPath));
					else
						str_copy(Item.m_aLocalPath, Item.m_aFilename, sizeof(Item.m_aLocalPath)); // Fallback
						Item.m_LatestVersion = (Version.type == json_integer) ? Version.u.integer : 0;
						Item.m_VersionCount = (VersionCount.type == json_integer) ? VersionCount.u.integer : 0;
						Item.m_TotalSize = (Size.type == json_integer) ? Size.u.integer : 0;
						if(Updated.type == json_string)
							str_copy(Item.m_aLastUpdated, Updated.u.string.ptr, sizeof(Item.m_aLastUpdated));
						
						m_vInventory.push_back(Item);
					}
					
					str_format(m_aStatusMessage, sizeof(m_aStatusMessage), "Inventory loaded: %d items", (int)m_vInventory.size());
					log_info("cloud", "Inventory loaded: %d items", (int)m_vInventory.size());
				}
				json_value_free(pJson);
			}
			else
			{
				str_copy(m_aStatusMessage, "Failed to load inventory", sizeof(m_aStatusMessage));
				log_error("cloud", "Failed to load inventory");
			}
		}
		else
		{
			str_copy(m_aStatusMessage, "Inventory request failed", sizeof(m_aStatusMessage));
			log_error("cloud", "Inventory request failed");
		}
		m_pInventoryRequest = nullptr;
	}
}

bool CCloud::IsLoggedIn() const
{
	return m_aToken[0] != 0;
}

const char *CCloud::GetStatusMessage() const
{
	return m_aStatusMessage;
}

void CCloud::GetInventory()
{
	if(m_aToken[0] == 0)
	{
		log_error("cloud", "Not logged in");
		return;
	}

	char aUrl[256];
	str_format(aUrl, sizeof(aUrl), "%s/assets/inventory", BASE_URL);

	auto pRequest = HttpGet(aUrl);
	
	char aAuth[512];
	str_format(aAuth, sizeof(aAuth), "Bearer %s", m_aToken);
	pRequest->HeaderString("Authorization", aAuth);

	m_pInventoryRequest = std::move(pRequest);
	m_pHttp->Run(m_pInventoryRequest);
	str_copy(m_aStatusMessage, "Fetching inventory...", sizeof(m_aStatusMessage));
	log_info("cloud", "Fetching inventory...");
}

const CCloud::SInventoryAsset *CCloud::GetInventoryAsset(int Index) const
{
	if(Index < 0 || Index >= (int)m_vInventory.size())
		return nullptr;
	return &m_vInventory[Index];
}
